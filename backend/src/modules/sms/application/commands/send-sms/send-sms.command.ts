import { Identity } from '@framework/domain';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';

export class SendSmsCommand {
  constructor(
    public readonly senderId: Identity,
    public readonly recipient: PhoneNumber,
    public readonly body: MessageBody,
  ) {}
}
