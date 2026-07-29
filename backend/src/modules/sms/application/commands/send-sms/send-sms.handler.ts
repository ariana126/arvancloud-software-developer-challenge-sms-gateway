import { CreditLedger } from '@credit/domain/service/credit-ledger';
import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { Clock, Identity } from '@framework/domain';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InsufficientCreditException } from '@sms/application/exceptions';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { SmsTariff } from '@sms/domain/sms-tariff';

import { SendSmsCommand } from './send-sms.command';

@CommandHandler(SendSmsCommand)
export class SendSmsHandler implements ICommandHandler<SendSmsCommand> {
  constructor(
    private readonly creditLedger: CreditLedger,
    private readonly smsProvider: SmsProvider,
    private readonly smsMessageRepository: SmsMessageRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Returns the new message's id, what it cost, and — for an express send only —
   * the instant it is guaranteed to reach the operator. A command handler
   * returning a value is a deliberate CQS deviation, and the same one
   * `LoginHandler` already makes: the id is minted inside `SmsMessage.send`, so
   * no follow-up query could name the row that was just written. The
   * alternative — having the controller read `SmsTariff.flat()` itself — would
   * still not solve the id, and would put a second reader on the price.
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

    // Ordering: charge, then dispatch, then record. Charging first is what makes
    // a short balance reject before anything leaves the building — the whole
    // point of the sufficiency check, and the reason no message is dispatched
    // that the sender cannot pay for.
    //
    // The accepted cost is the window it opens. If `deliver` throws after the
    // charge has landed, the user stays charged for a message that never went
    // out, and there is deliberately no refund path: a compensating
    // `Wallet.refund` plus the idempotency machinery to keep a retry from
    // double-refunding is out of scope for this slice. The same is true of a
    // crash between the charge and the save, which additionally leaves the send
    // unrecorded — `charge` and `save` are separate transactions with a network
    // call between them, and the published `CreditLedger` port carries no
    // transaction handle by design. Both trades are pinned by tests in this
    // file's spec so they read as decisions rather than oversights.
    await this.chargeFor(command.senderId, tariff);
    await this.smsProvider.deliver(command.recipient, command.body);

    const message = SmsMessage.send(
      command.senderId,
      command.recipient,
      command.body,
      command.serviceLevel,
      this.clock.now(),
    );
    await this.smsMessageRepository.save(message);

    // Rendered as ISO-8601 here for the same reason `id` is rendered as a string:
    // this shape leaves the application layer, so it carries wire types rather
    // than domain ones.
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
