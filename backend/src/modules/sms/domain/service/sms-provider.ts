import { Identity } from '@framework/domain';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';

/**
 * The port for handing a message to whatever actually carries it. It takes the
 * values it needs rather than the `SmsMessage` aggregate, so an adapter can
 * never reach for state it has no business reading.
 *
 * `deliver` rather than `send`, to keep it distinct from `SmsMessage.queue`,
 * which records that a send was accepted.
 *
 * **`messageId` is an idempotency key, not a label.** Delivery is at-least-once:
 * if the carrier accepts a message and the outbox row cannot then be cleared —
 * the connection drops, the process dies — the relay attempts it again. An
 * adapter is expected to hand this to a carrier that de-duplicates on it, so the
 * recipient sees one message rather than two. `LoggingSmsProvider` ignores it,
 * having nothing to de-duplicate against.
 */
export abstract class SmsProvider {
  abstract deliver(
    messageId: Identity,
    recipient: PhoneNumber,
    body: MessageBody,
  ): Promise<void>;
}
