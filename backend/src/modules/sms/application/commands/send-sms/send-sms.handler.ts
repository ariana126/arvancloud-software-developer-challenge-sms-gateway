import { CreditLedger } from '@credit/domain/service/credit-ledger';
import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { Clock, Identity, UnitOfWork } from '@framework/domain';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InsufficientCreditException } from '@sms/application/exceptions';
import { SenderTrafficRepository } from '@sms/domain/service/sender-traffic.repository';
import { SmsDispatcher } from '@sms/domain/service/sms-dispatcher';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsOutboxRepository } from '@sms/domain/service/sms-outbox.repository';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { SmsTariff } from '@sms/domain/sms-tariff';
import { DispatchLane } from '@sms/domain/value/dispatch-lane';
import { TrafficPolicy } from '@sms/domain/value/traffic-policy';
import { TrafficTier } from '@sms/domain/value/traffic-tier';

import { SendSmsCommand } from './send-sms.command';

@CommandHandler(SendSmsCommand)
export class SendSmsHandler implements ICommandHandler<SendSmsCommand> {
  constructor(
    private readonly creditLedger: CreditLedger,
    private readonly smsMessageRepository: SmsMessageRepository,
    private readonly outbox: SmsOutboxRepository,
    private readonly senderTraffic: SenderTrafficRepository,
    private readonly dispatcher: SmsDispatcher,
    private readonly unitOfWork: UnitOfWork,
    private readonly policy: TrafficPolicy,
    private readonly clock: Clock,
  ) {}

  /**
   * Returns the new message's id, what it cost, and — for an express send only —
   * the instant it is guaranteed to reach the operator. A command handler
   * returning a value is a deliberate CQS deviation, and the same one
   * `LoginHandler` already makes: the id is minted inside `SmsMessage.queue`, so
   * no follow-up query could name the row that was just written.
   *
   * `guaranteedDeliveryAt` is **absent**, not null, when the service level
   * promises nothing: a standard send makes no claim about when the message
   * arrives, and a null would read as a claim that the answer is unknown.
   */
  async execute(command: SendSmsCommand): Promise<{
    id: string;
    cost: number;
    guaranteedDeliveryAt?: string;
  }> {
    const now = this.clock.now();
    const tariff = SmsTariff.flat();
    const message = SmsMessage.queue(
      command.senderId,
      command.recipient,
      command.body,
      command.serviceLevel,
      now,
    );

    // Charge, count, record, and enqueue the dispatch — **one transaction**.
    // Charging first is what makes a short balance reject before anything else
    // happens; committing it all together is what makes it impossible to take
    // money without also recording what it was taken for and what is now owed. A
    // crash anywhere in here leaves nothing behind, which is the whole
    // difference from the separate writes this used to be.
    //
    // The traffic count belongs in here for the same reason and one more: a send
    // that rolls back must not leave itself counted against its sender, or a
    // customer could be classified as high-volume on the strength of messages
    // that were never accepted.
    //
    // The broker is deliberately outside it: a transaction held open across
    // somebody else's network keeps a wallet row locked for as long as their
    // network takes.
    const dispatch = await this.unitOfWork.execute(async () => {
      await this.chargeFor(command.senderId, tariff);
      const lane = await this.laneFor(command, now);
      await this.smsMessageRepository.save(message);
      return this.outbox.enqueue(message, lane, now);
    });

    // Published here, in the request, so that in the normal case the message is
    // already on its dispatch lane by the time the sender is told — and so the
    // outbox relay finds nothing to do, which is the state it is meant to be in.
    // `dispatch` never throws: a broker that refuses leaves the outbox row for
    // the relay, and the send stays accepted, because it is — paid for,
    // recorded, and owed.
    //
    // Note what this is *not*: the carrier has not seen the message yet, and
    // will not until a worker consumes the lane. That is why the message is left
    // `QUEUED` rather than `SENT`.
    await this.dispatcher.dispatch(dispatch);

    // Rendered as ISO-8601 here for the same reason `id` is rendered as a
    // string: this shape leaves the application layer, so it carries wire types
    // rather than domain ones.
    const guaranteedDeliveryAt = message.guaranteedDeliveryAt();

    return {
      id: message.id.asString(),
      cost: tariff.costPerSms(),
      ...(guaranteedDeliveryAt
        ? { guaranteedDeliveryAt: guaranteedDeliveryAt.toISOString() }
        : {}),
    };
  }

  /**
   * Decides which isolated path this message travels on, by counting it against
   * its sender's recent traffic and asking the routing rule.
   *
   * The count and the decision are one step on purpose. `recordSend` returns the
   * window's total **including this send**, so a customer that crosses the
   * threshold is reclassified by the very message that crossed it rather than by
   * the next one — with a separate read-then-classify, the first message of every
   * burst would be routed on the strength of how quiet things were beforehand.
   *
   * Note the express short-circuit lives in `DispatchLane.for`, not here: this
   * method counts every send, express included, because an express message is
   * still traffic this system has to carry even though it is not what decides
   * that message's lane.
   */
  private async laneFor(
    command: SendSmsCommand,
    now: Date,
  ): Promise<DispatchLane> {
    const traffic = await this.senderTraffic.recordSend(
      command.senderId,
      now,
      this.policy,
    );
    const tier = TrafficTier.forSendCount(
      traffic.sendCountInWindow,
      this.policy,
    );

    return DispatchLane.for(command.serviceLevel, tier);
  }

  /**
   * Translates credit's published failure into this module's own. Only
   * `InsufficientCredit` is converted — every other error rethrows untouched, so
   * a database failure inside the ledger can never masquerade as a payment
   * problem and reach the client as a 402.
   */
  private async chargeFor(
    senderId: Identity,
    tariff: SmsTariff,
  ): Promise<void> {
    try {
      await this.creditLedger.charge(senderId, tariff.costPerSms());
    } catch (error) {
      if (error instanceof InsufficientCredit) {
        throw InsufficientCreditException.forSms(
          senderId,
          error.required,
          error.available,
        );
      }
      throw error;
    }
  }
}
