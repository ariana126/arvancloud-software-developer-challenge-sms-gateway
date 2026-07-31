import {
  PrismaEntityRepository,
  PrismaService,
} from '@framework/infrastructure';
import { Injectable, Logger } from '@nestjs/common';
import { EventBus, IEvent } from '@nestjs/cqrs';
import { SmsMessage as PrismaSmsMessage } from '@prisma/client';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { SmsStatus } from '@sms/domain/value/sms-status';

import { SmsMessageMapper } from './sms-message.mapper';

/**
 * Persists a message as a **guarded forward transition**, not as a whole state.
 *
 * A message has two writers. The API writes it `PENDING` alongside the charge
 * and `QUEUED` once the broker acknowledges the publish; a worker consuming
 * that lane writes `SENT` or `FAILED` once the carrier has answered. Those are
 * separate processes, and they race: the worker regularly settles a message
 * before the API's post-publish transaction has committed.
 *
 * The base class's unconditional upsert loses that race silently — it writes
 * whatever whole state the writer read a moment ago, so the API's `QUEUED`
 * lands on top of the worker's `SENT` and the message is reported as
 * undelivered forever. (Measured, not theorised: 40 concurrent sends left 39 of
 * 45 rows stuck at `QUEUED` with the consumer group fully caught up.) So each
 * write carries the statuses it is allowed to follow, and a write that matches
 * nothing simply did not happen.
 *
 * This is the same medicine `PrismaWalletRepository` takes, for the same
 * disease, and the rule is likewise stated twice on purpose: `SmsMessage`
 * refuses a backwards transition it can see, and this refuses the one it
 * cannot — a concurrent writer is visible only to the database.
 *
 * There is no version column and no retry loop. A conditional write does not
 * race, so there is no lost attempt to detect and repeat.
 */
@Injectable()
export class PrismaSmsMessageRepository
  extends PrismaEntityRepository<SmsMessage, PrismaSmsMessage>
  implements SmsMessageRepository
{
  private readonly logger = new Logger(PrismaSmsMessageRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    // Named distinctly from the base class's own private `eventBus` field —
    // TypeScript treats two same-named `private` members across a class
    // hierarchy as incompatible declarations, not a normal override.
    private readonly domainEventBus: EventBus,
  ) {
    super((client) => client.smsMessage, prisma, domainEventBus);
  }

  /**
   * Events are published only once the write has landed, and only if it landed.
   * A refused transition must not announce `SmsSent` for a message somebody
   * else had already settled.
   *
   * Everything goes through `this.prisma.client()` rather than a captured
   * delegate, for the reason the base class resolves its own per call: the
   * client is whatever `UnitOfWork` has made current, and a delegate captured
   * in the constructor would write outside the transaction opened later.
   */
  async save(message: SmsMessage): Promise<void> {
    const record = SmsMessageMapper.toPersistence(message);
    const allowed = SmsStatus.fromString(record.status)
      .reachableFrom()
      .map((status) => status.toString());

    if (allowed.length === 0) {
      // `PENDING` follows nothing, so this is the message coming into
      // existence — in the same transaction as the charge that paid for it.
      await this.prisma.client().smsMessage.create({ data: record });
    } else {
      const { id, ...changes } = record;
      const { count } = await this.prisma.client().smsMessage.updateMany({
        where: { id, status: { in: allowed } },
        data: changes,
      });

      if (count === 0) {
        // Not an error, and routine on both sides: the API finding a message
        // the worker already delivered, or a redelivery arriving after the
        // message was settled. Somebody else has already moved it further than
        // this write would.
        this.logger.debug(
          `Left SMS ${id} alone: it is no longer in ${allowed.join(' or ')}, so it cannot move to ${record.status}.`,
        );
        message.releaseEvents();
        return;
      }
    }

    this.domainEventBus.publishAll(message.releaseEvents() as IEvent[]);
  }

  protected toDomain(record: PrismaSmsMessage): SmsMessage {
    return SmsMessageMapper.toDomain(record);
  }

  protected toPersistence(entity: SmsMessage): PrismaSmsMessage {
    return SmsMessageMapper.toPersistence(entity);
  }
}
