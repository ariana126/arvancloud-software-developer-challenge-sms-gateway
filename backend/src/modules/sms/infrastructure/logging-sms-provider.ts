import { Identity } from '@framework/domain';
import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';

/**
 * The stand-in carrier: it logs the message instead of sending it. This is the
 * whole point of `SmsProvider` being a port — swapping in a real carrier is a
 * new class and one line in `SmsModule`, with nothing above this layer changing.
 *
 * It never throws, which is worth knowing when reading the outbox: the retry,
 * backoff and dead-letter paths in `OutboxSmsDispatcher` are real but
 * unreachable through this provider, and become reachable the moment one that
 * can fail replaces it. The tests are where they are exercised.
 *
 * `messageId` is logged rather than used. A real carrier would receive it as an
 * idempotency key — see `SmsProvider` — but there is nothing here to
 * de-duplicate, so it serves only to tie a log line to a row.
 */
@Injectable()
export class LoggingSmsProvider extends SmsProvider {
  private readonly logger = new Logger(LoggingSmsProvider.name);

  deliver(
    messageId: Identity,
    recipient: PhoneNumber,
    body: MessageBody,
  ): Promise<void> {
    this.logger.log(
      `Delivering SMS ${messageId.asString()} to ${recipient.asString()}: ${body.asString()}`,
    );
    return Promise.resolve();
  }
}
