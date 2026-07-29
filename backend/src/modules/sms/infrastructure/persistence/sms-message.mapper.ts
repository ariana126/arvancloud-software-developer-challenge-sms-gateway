import { Identity } from '@framework/domain';
import { SmsMessage as PrismaSmsMessage } from '@prisma/client';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { SmsStatus } from '@sms/domain/value/sms-status';

export class SmsMessageMapper {
  public static toDomain(record: PrismaSmsMessage): SmsMessage {
    return new SmsMessage(
      Identity.fromString(record.id),
      Identity.fromString(record.senderId),
      PhoneNumber.fromString(record.recipient),
      MessageBody.fromString(record.body),
      // `SENT` is the only status this gateway ever writes, so reconstructing
      // it is not lossy. A second status means a `SmsStatus.fromString` on the
      // domain type and reading `record.status` here — until then, a factory
      // that could only ever return one value would be dead code.
      SmsStatus.sent(),
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
