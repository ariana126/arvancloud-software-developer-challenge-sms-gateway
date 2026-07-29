import { AggregateRoot, Identity } from '@framework/domain';

import { SmsSent } from './events/sms-sent.event';
import { MessageBody } from './value/message-body';
import { PhoneNumber } from './value/phone-number';
import { SmsStatus } from './value/sms-status';

export class SmsMessage extends AggregateRoot {
  constructor(
    id: Identity,
    private senderId: Identity,
    private recipient: PhoneNumber,
    private body: MessageBody,
    private status: SmsStatus,
    private sentAt: Date,
  ) {
    super(id);
  }

  /**
   * Records a message that has been dispatched. `sentAt` is supplied by the
   * caller from an injected `Clock` rather than read from the system clock —
   * same as `User.register`.
   */
  public static send(
    senderId: Identity,
    recipient: PhoneNumber,
    body: MessageBody,
    sentAt: Date,
  ): SmsMessage {
    const message = new SmsMessage(
      Identity.new(),
      senderId,
      recipient,
      body,
      SmsStatus.sent(),
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

  public toPrimitives(): object {
    return {
      id: this.id.asString(),
      senderId: this.senderId.asString(),
      recipient: this.recipient.asString(),
      body: this.body.asString(),
      status: this.status.toString(),
      sentAt: this.sentAt,
    };
  }
}
