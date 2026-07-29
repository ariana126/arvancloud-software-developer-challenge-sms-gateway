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
   * Records a message that has been dispatched. `sentAt` is supplied by the
   * caller from an injected `Clock` rather than read from the system clock —
   * same as `User.register`.
   *
   * The service level is a parameter of the send rather than a second factory:
   * express is how a message goes out, not a different thing to do with one, and
   * it costs the same.
   */
  public static send(
    senderId: Identity,
    recipient: PhoneNumber,
    body: MessageBody,
    serviceLevel: ServiceLevel,
    sentAt: Date,
  ): SmsMessage {
    const message = new SmsMessage(
      Identity.new(),
      senderId,
      recipient,
      body,
      SmsStatus.sent(),
      serviceLevel,
      sentAt,
    );
    message.recordThat(
      new SmsSent(
        message.id.asString(),
        senderId.asString(),
        recipient.asString(),
        sentAt,
      ),
    );
    return message;
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
