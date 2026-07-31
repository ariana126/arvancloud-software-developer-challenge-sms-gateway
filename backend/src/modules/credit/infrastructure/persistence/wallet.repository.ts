import { CreditDecreased } from '@credit/domain/events/credit-decreased.event';
import { CreditIncreased } from '@credit/domain/events/credit-increased.event';
import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { DomainEvent, Identity } from '@framework/domain';
import {
  PrismaEntityRepository,
  PrismaService,
} from '@framework/infrastructure';
import { Injectable } from '@nestjs/common';
import { EventBus, IEvent } from '@nestjs/cqrs';
import { Wallet as PrismaWallet } from '@prisma/client';

import { WalletMapper } from './wallet.mapper';

/**
 * Persists a wallet as **conditional deltas**, not as a balance.
 *
 * The aggregate has already decided what should happen and recorded it —
 * `CreditIncreased`, `CreditDecreased` — so this translates each event into one
 * statement the database applies atomically:
 *
 * - an increase becomes `balance = balance + amount` (an upsert, since the first
 *   top-up is also what opens the wallet);
 * - a decrease becomes `balance = balance - amount` **guarded by
 *   `balance >= amount`**, and a zero-row result means the guard refused it.
 *
 * Writing `entity.getBalance()` as an absolute value instead — which is what the
 * inherited upsert would do — is the lost update this exists to prevent: two
 * requests read 1000, both subtract 1000 in memory, both write 0, and one SMS
 * has been given away. Postgres serialises the two UPDATEs on the row lock and
 * re-evaluates the loser's `WHERE` against the committed row under READ
 * COMMITTED, so the second matches nothing and is told so.
 *
 * That guard duplicates `Wallet.decrease`'s check, and that is deliberate: the
 * aggregate is where the rule is *written*, and where a short balance is
 * rejected with the numbers to explain it; the database is where the rule is
 * *enforced* when two requests arrive at once. Neither alone is enough — the
 * aggregate cannot see a concurrent writer, and SQL cannot produce a domain
 * error worth reading.
 *
 * There is no version column and no retry loop. A conditional write does not
 * race, so there is no lost attempt to detect and repeat.
 */
@Injectable()
export class PrismaWalletRepository
  extends PrismaEntityRepository<Wallet, PrismaWallet>
  implements WalletRepository
{
  constructor(
    private readonly prisma: PrismaService,
    // Named distinctly from the base class's own private `eventBus` field —
    // TypeScript treats two same-named `private` members across a class
    // hierarchy as incompatible declarations, not a normal override.
    private readonly domainEventBus: EventBus,
  ) {
    super((client) => client.wallet, prisma, domainEventBus);
  }

  protected toDomain(record: PrismaWallet): Wallet {
    return WalletMapper.toDomain(record);
  }

  protected toPersistence(entity: Wallet): PrismaWallet {
    return WalletMapper.toPersistence(entity);
  }

  /**
   * A wallet with nothing recorded on it writes nothing — the honest answer for
   * a bare `Wallet.open()`, since an unfunded wallet and an absent row are the
   * same thing to every reader here.
   *
   * Events are published only once every statement has landed. A decrease that
   * the database refuses throws out of the loop, so `CreditDecreased` is never
   * announced for money that was not taken.
   */
  async save(entity: Wallet): Promise<void> {
    const events = entity.releaseEvents();

    for (const event of events) {
      await this.apply(entity.id, event);
    }

    this.domainEventBus.publishAll(events as IEvent[]);
  }

  private async apply(id: Identity, event: DomainEvent): Promise<void> {
    if (event instanceof CreditIncreased) {
      await this.credit(id, event.amount);
      return;
    }
    if (event instanceof CreditDecreased) {
      await this.debit(id, event.amount);
    }
  }

  /**
   * `upsert` rather than `update`, because the first top-up is what brings the
   * row into existence. Prisma compiles this to a single
   * `INSERT … ON CONFLICT DO UPDATE`, so two concurrent first-ever top-ups
   * cannot both insert — the loser becomes the increment.
   */
  private async credit(id: Identity, amount: number): Promise<void> {
    await this.prisma.client().wallet.upsert({
      where: { id: id.asString() },
      create: { id: id.asString(), balance: amount },
      update: { balance: { increment: amount } },
    });
  }

  private async debit(id: Identity, amount: number): Promise<void> {
    const result = await this.prisma.client().wallet.updateMany({
      where: { id: id.asString(), balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });

    if (result.count === 0) {
      throw InsufficientCredit.forWallet(id, amount, await this.balanceOf(id));
    }
  }

  /**
   * Read only to explain a refusal, so the extra round trip falls on the
   * rejected path alone. It reports the balance *now* rather than the one the
   * caller read a moment ago — which is the number that actually explains why
   * the charge was refused.
   */
  private async balanceOf(id: Identity): Promise<number> {
    const record = await this.prisma.client().wallet.findUnique({
      where: { id: id.asString() },
    });
    return record?.balance ?? 0;
  }
}
