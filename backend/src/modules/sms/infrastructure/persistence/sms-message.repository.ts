import {
  PrismaEntityRepository,
  PrismaService,
} from '@framework/infrastructure';
import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { SmsMessage as PrismaSmsMessage } from '@prisma/client';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';

import { SmsMessageMapper } from './sms-message.mapper';

/**
 * Inherits the base `save()` — an unconditional upsert keyed on `id`.
 *
 * A message **is** written twice now: once as `PENDING` alongside the charge,
 * and again as `SENT` or `FAILED` once the carrier has answered. That is still
 * safe to do unconditionally, but for a narrower reason than before: only one
 * party is ever writing a given message. The id is freshly minted, and the
 * second write is made by whoever holds the outbox claim for it — and the claim
 * is exclusive. Two writers cannot race here because there are never two.
 *
 * `PrismaWalletRepository` is the counter-example, and the distinction is worth
 * keeping straight: a wallet has many concurrent writers by nature, so it may
 * never be written as a whole state. It writes guarded deltas instead. Anything
 * here that grows a second writer must do the same rather than inheriting this
 * class's silence on the matter.
 */
@Injectable()
export class PrismaSmsMessageRepository
  extends PrismaEntityRepository<SmsMessage, PrismaSmsMessage>
  implements SmsMessageRepository
{
  constructor(prisma: PrismaService, eventBus: EventBus) {
    super((client) => client.smsMessage, prisma, eventBus);
  }

  protected toDomain(record: PrismaSmsMessage): SmsMessage {
    return SmsMessageMapper.toDomain(record);
  }

  protected toPersistence(entity: SmsMessage): PrismaSmsMessage {
    return SmsMessageMapper.toPersistence(entity);
  }
}
