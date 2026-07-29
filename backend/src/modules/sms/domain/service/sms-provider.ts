import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';

/**
 * The port for handing a message to whatever actually carries it. It takes the
 * two values it needs rather than the `SmsMessage` aggregate, so an adapter can
 * never reach for state it has no business reading.
 *
 * `deliver` rather than `send`, to keep it distinct from `SmsMessage.send`,
 * which records that a delivery happened.
 */
export abstract class SmsProvider {
  abstract deliver(recipient: PhoneNumber, body: MessageBody): Promise<void>;
}
