import { Injectable } from '@nestjs/common';
import { SmsDispatchPublisher } from '@sms/domain/service/sms-dispatch-publisher';
import { SmsDispatch } from '@sms/domain/service/sms-outbox.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';

/**
 * Publishes a dispatch by handing it straight to the carrier, in-process.
 *
 * This is the whole of the broker-free arrangement: a send is dispatched in the
 * request that made it, and the relay only picks up what that request could not
 * finish. Swapping this class for a Kafka producer is what makes dispatch
 * asynchronous — and nothing else in the module has to move, because the outbox
 * row was already the message.
 */
@Injectable()
export class ProviderSmsDispatchPublisher extends SmsDispatchPublisher {
  constructor(private readonly smsProvider: SmsProvider) {
    super();
  }

  public async publish(dispatch: SmsDispatch): Promise<void> {
    await this.smsProvider.deliver(
      dispatch.messageId,
      dispatch.recipient,
      dispatch.body,
    );
  }
}
