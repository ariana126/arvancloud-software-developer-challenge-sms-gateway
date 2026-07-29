import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';

/**
 * The stand-in carrier: it logs the message instead of sending it. This is the
 * whole point of `SmsProvider` being a port — swapping in a real carrier is a
 * new class and one line in `SmsModule`, with nothing above this layer changing.
 *
 * It never throws, which is worth knowing when reading `SendSmsHandler`: the
 * charge-then-dispatch window it documents is real but currently unreachable,
 * and becomes reachable the moment a provider that can fail replaces this one.
 */
@Injectable()
export class LoggingSmsProvider extends SmsProvider {
  private readonly logger = new Logger(LoggingSmsProvider.name);

  deliver(recipient: PhoneNumber, body: MessageBody): Promise<void> {
    this.logger.log(
      `Delivering SMS to ${recipient.asString()}: ${body.asString()}`,
    );
    return Promise.resolve();
  }
}
