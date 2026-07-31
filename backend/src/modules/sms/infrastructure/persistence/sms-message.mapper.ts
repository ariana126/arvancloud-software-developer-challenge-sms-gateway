import { Identity } from '@framework/domain';
import { SmsMessage as PrismaSmsMessage } from '@prisma/client';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { ServiceLevel } from '@sms/domain/value/service-level';
import { SmsStatus } from '@sms/domain/value/sms-status';

export class SmsMessageMapper {
  public static toDomain(record: PrismaSmsMessage): SmsMessage {
    return new SmsMessage(
      Identity.fromString(record.id),
      Identity.fromString(record.senderId),
      PhoneNumber.fromString(record.recipient),
      MessageBody.fromString(record.body),
      // Read back, now that a message has a life: it is written PENDING with
      // the charge and only becomes SENT once the carrier has taken it, so
      // assuming a status here would report messages as sent that are still
      // sitting in the outbox — or that were dead-lettered.
      SmsStatus.fromString(record.status),
      // Read back, unlike the status: there really are two service levels, and
      // which one a message was sent at is not recoverable from anything else.
      // There is no stored delivery guarantee to read — `ServiceLevel` derives
      // it from `sentAt`, so the express window lives in exactly one place.
      ServiceLevel.fromString(record.serviceLevel),
      record.sentAt,
    );
  }

  // `toPrimitives()` is typed `: object`, so this cast is unchecked — adding a
  // column to sms.prisma without adding it to the aggregate compiles cleanly
  // and fails at runtime. Change both together.
  public static toPersistence(message: SmsMessage): PrismaSmsMessage {
    return message.toPrimitives() as PrismaSmsMessage;
  }
}
