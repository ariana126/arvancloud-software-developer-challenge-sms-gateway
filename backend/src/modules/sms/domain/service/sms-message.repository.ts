import { EntityRepository } from '@framework/domain';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';

/**
 * Adds nothing to `EntityRepository`: this slice only ever writes a message and
 * never looks one up. It exists as the abstract class NestJS DI binds the
 * Prisma implementation to, and as the name the application layer depends on.
 */
export abstract class SmsMessageRepository extends EntityRepository<SmsMessage> {}
