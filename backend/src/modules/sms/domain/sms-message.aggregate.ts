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
   */
  public markQueued(): void {
    this.status = SmsStatus.queued();
  }

  /**
   * The carrier took it. `SmsSent` is recorded **here** rather than in `queue`,
   * because that is when it becomes true — announcing a send at acceptance time
   * would tell the rest of the system a message went out that might still be
   * sitting in the outbox, or on a partition.
   */
  public markSent(): void {
    this.status = SmsStatus.sent();
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
    this.status = SmsStatus.failed();
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
