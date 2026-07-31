import { CreditLedger } from '@credit/domain/service/credit-ledger';
import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { Clock, Identity, UnitOfWork } from '@framework/domain';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InsufficientCreditException } from '@sms/application/exceptions';
import { SmsDispatcher } from '@sms/domain/service/sms-dispatcher';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsOutboxRepository } from '@sms/domain/service/sms-outbox.repository';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { SmsTariff } from '@sms/domain/sms-tariff';

import { SendSmsCommand } from './send-sms.command';

@CommandHandler(SendSmsCommand)
export class SendSmsHandler implements ICommandHandler<SendSmsCommand> {
  constructor(
    private readonly creditLedger: CreditLedger,
    private readonly smsMessageRepository: SmsMessageRepository,
    private readonly outbox: SmsOutboxRepository,
    private readonly dispatcher: SmsDispatcher,
    private readonly unitOfWork: UnitOfWork,
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
    const tariff = SmsTariff.flat();
    const message = SmsMessage.queue(
      command.senderId,
      command.recipient,
      command.body,
      command.serviceLevel,
      this.clock.now(),
    );

    // Charge, record, and enqueue the dispatch — **one transaction**. Charging
    // first is what makes a short balance reject before anything else happens;
    // committing all three together is what makes it impossible to take money
    // without also recording what it was taken for and what is now owed. A crash
    // anywhere in here leaves nothing behind, which is the whole difference from
    // the three separate writes this used to be.
    //
    // The carrier is deliberately outside it: a transaction held open across
    // somebody else's network keeps a wallet row locked for as long as their
    // network takes.
    const dispatch = await this.unitOfWork.execute(async () => {
      await this.chargeFor(command.senderId, tariff);
      await this.smsMessageRepository.save(message);
      return this.outbox.enqueue(message, this.clock.now());
    });

    // Attempted here, in the request, so that in the normal case the message
    // really has gone by the time the sender is told. `dispatch` never throws —
    // a carrier that refuses leaves the outbox row for the relay, and the send
    // stays accepted, because it is: paid for, recorded, and owed.
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
