import { AggregateRoot, Identity } from '@framework/domain';

import { SmsSent } from './events/sms-sent.event';
import { MessageBody } from './value/message-body';
import { PhoneNumber } from './value/phone-number';
import { ServiceLevel } from './value/service-level';
import { SmsStatus } from './value/sms-status';

export class SmsMessage extends AggregateRoot {
  constructor(
    id: Identity,
    private senderId: Identity,
    private recipient: PhoneNumber,
    private body: MessageBody,
    private status: SmsStatus,
    private serviceLevel: ServiceLevel,
    private sentAt: Date,
  ) {
    super(id);
  }

  /**
   * Accepts a message for sending: charged for, recorded, and owed a dispatch.
   *
   * **`queue`, not `send`** — the carrier has not seen it yet. This is written
   * in the same transaction as the debit, before anything leaves the building,
   * so that a crash can never take money without leaving a record of what it was
   * taken for. `markSent` or `markFailed` closes it out afterwards.
   *
   * `sentAt` is supplied by the caller from an injected `Clock`, and is the
   * instant the send was **accepted** rather than the instant the carrier took
   * it. That is the honest reading for a delivery guarantee — express promises a
   * window from when we took the message — and it means the express arithmetic
   * in `ServiceLevel` needs no second timestamp.
   *
   * The service level is a parameter rather than a second factory: express is
   * how a message goes out, not a different thing to do with one, and it costs
   * the same.
   */
  public static queue(
    senderId: Identity,
    recipient: PhoneNumber,
    body: MessageBody,
    serviceLevel: ServiceLevel,
    sentAt: Date,
  ): SmsMessage {
    return new SmsMessage(
      Identity.new(),
      senderId,
      recipient,
      body,
      SmsStatus.pending(),
      serviceLevel,
      sentAt,
    );
  }

  /**
   * The broker has it. The outbox row has been settled and no further attempt is
   * owed by this service — but no carrier has seen the message yet, so this is
   * emphatically not `markSent`.
   *
   * Keeping the two apart is what stops the report from claiming delivery it
   * cannot vouch for. A publish that Kafka acknowledges proves only that the
   * dispatch is durable and on its lane; the worker consuming that lane is what
   * eventually calls `markSent`. No event, because "we handed it to ourselves"
   * is not news to anybody downstream.
   *
   * **A no-op once the carrier has answered**, and quietly so. The worker
   * consuming the lane often marks a message `SENT` before the API's
   * post-publish transaction has committed `QUEUED`, and "the broker has it" is
   * already implied by "the carrier took it" — so there is nothing to complain
   * about and nothing to write. Throwing instead would be worse than useless:
   * this runs inside `OutboxSmsDispatcher`'s settle transaction, so it would
   * roll back the settle, leave the outbox row to be reclaimed, and republish
   * the message as a duplicate.
   */
  public markQueued(): void {
    this.moveTo(SmsStatus.queued());
  }

  /**
   * The carrier took it. `SmsSent` is recorded **here** rather than in `queue`,
   * because that is when it becomes true — announcing a send at acceptance time
   * would tell the rest of the system a message went out that might still be
   * sitting in the outbox, or on a partition.
   *
   * The event is recorded only when the status actually moves, so a redelivery
   * of an already-settled message — which at-least-once delivery makes routine
   * — cannot announce a second `SmsSent` for one send.
   */
  public markSent(): void {
    if (!this.moveTo(SmsStatus.sent())) {
      return;
    }
    this.recordThat(
      new SmsSent(
        this.id.asString(),
        this.senderId.asString(),
        this.recipient.asString(),
        this.sentAt,
      ),
    );
  }

  /**
   * We have stopped trying. No event: nothing downstream has a use for it today,
   * and the dead-lettered outbox row is the record an operator actually works
   * from.
   */
  public markFailed(): void {
    this.moveTo(SmsStatus.failed());
  }

  /**
   * Moves the status forward, or refuses and says so.
   *
   * This is the rule *written*; `PrismaSmsMessageRepository` states it a second
   * time in SQL, which is the only place a concurrent writer can be seen. The
   * pair is deliberate and matches how `Wallet` and `PrismaWalletRepository`
   * split the same job: an aggregate reasons about the state it read, and a
   * state it read a moment ago is exactly what a racing writer invalidates.
   */
  private moveTo(next: SmsStatus): boolean {
    if (!next.canFollow(this.status)) {
      return false;
    }
    this.status = next;
    return true;
  }

  public isSent(): boolean {
    return this.status.isSent();
  }

  public getRecipient(): PhoneNumber {
    return this.recipient;
  }

  public getBody(): MessageBody {
    return this.body;
  }

  /**
   * The instant by which this message is guaranteed to reach the operator — the
   * operator, not the handset — or nothing when the level it was sent at makes
   * no such promise. Derived, never stored: `ServiceLevel` owns the window, and
   * a persisted copy of this value would be free to disagree with it.
   */
  public guaranteedDeliveryAt(): Date | undefined {
    return this.serviceLevel.guaranteedDeliveryFrom(this.sentAt);
  }

  public toPrimitives(): object {
    return {
      id: this.id.asString(),
      senderId: this.senderId.asString(),
      recipient: this.recipient.asString(),
      body: this.body.asString(),
      status: this.status.toString(),
      serviceLevel: this.serviceLevel.toString(),
      sentAt: this.sentAt,
    };
  }
}
