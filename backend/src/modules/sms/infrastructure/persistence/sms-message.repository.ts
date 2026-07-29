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
 * Inherits the base `save()` — an unconditional upsert keyed on `id` — and that
 * is safe **only because `SmsMessage` is append-only on a freshly minted UUID**.
 * Every save is the first and last write for that id, so there is no read,
 * no in-flight version, and no lost update to lose.
 *
 * A mutable aggregate cannot rely on this. `PrismaWalletRepository` is the
 * counter-example: a wallet is read, modified and written back, so the base
 * upsert would let two requests both read balance-at-version-4 and both write,
 * silently double-spending. It therefore overrides `save()` with a
 * version-conditional `updateMany` whose zero-row result becomes a
 * `WalletVersionConflict`. Anything here that grows an update path must do the
 * same rather than inheriting this class's silence on the matter.
 */
@Injectable()
export class PrismaSmsMessageRepository
  extends PrismaEntityRepository<SmsMessage, PrismaSmsMessage>
  implements SmsMessageRepository
{
  constructor(prisma: PrismaService, eventBus: EventBus) {
    super(prisma.smsMessage, eventBus);
  }

  protected toDomain(record: PrismaSmsMessage): SmsMessage {
    return SmsMessageMapper.toDomain(record);
  }

  protected toPersistence(entity: SmsMessage): PrismaSmsMessage {
    return SmsMessageMapper.toPersistence(entity);
  }
}
