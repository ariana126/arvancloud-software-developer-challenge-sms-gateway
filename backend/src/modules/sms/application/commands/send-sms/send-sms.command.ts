import { Identity } from '@framework/domain';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { ServiceLevel } from '@sms/domain/value/service-level';

export class SendSmsCommand {
  constructor(
    public readonly senderId: Identity,
    public readonly recipient: PhoneNumber,
    public readonly body: MessageBody,
    /**
     * Required, with no default: defaulting an omitted service level is a
     * decision about the wire, so it belongs to the DTO that reads the request,
     * not to the command every caller has to fill in.
     */
    public readonly serviceLevel: ServiceLevel,
  ) {}
}
