import { WalletVersionConflict } from '@credit/domain/exception/wallet-version-conflict.exception';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Wallet } from '@credit/domain/wallet.aggregate';
import {
  PrismaEntityRepository,
  PrismaService,
} from '@framework/infrastructure';
import { Injectable } from '@nestjs/common';
import { EventBus, IEvent } from '@nestjs/cqrs';
import { Prisma, Wallet as PrismaWallet } from '@prisma/client';

import { WalletMapper } from './wallet.mapper';

/**
 * A wallet's version is a pure persistence concern (see the domain-layer
 * plan) and is never exposed on the `Wallet` aggregate itself, so it can't be
 * carried alongside the entity the way `toPrimitives()` carries `id`/`balance`.
 * Instead this repository remembers, per loaded instance, which version it
 * was read at — a `WeakMap` rather than a field on `Wallet`, so no domain
 * code (or `WalletMapper`) ever needs to know a version exists. An instance
 * absent from the map has never been persisted, i.e. it came from
 * `Wallet.open()`, and `save()` treats that as an insert rather than a
 * conditional update.
 */
@Injectable()
export class PrismaWalletRepository
  extends PrismaEntityRepository<Wallet, PrismaWallet>
  implements WalletRepository
{
  private readonly versions = new WeakMap<Wallet, number>();

  constructor(
    private readonly prisma: PrismaService,
    // Named distinctly from the base class's own private `eventBus` field —
    // TypeScript treats two same-named `private` members across a class
    // hierarchy as incompatible declarations, not a normal override.
    private readonly domainEventBus: EventBus,
  ) {
    super(prisma.wallet, domainEventBus);
  }

  protected toDomain(record: PrismaWallet): Wallet {
    const wallet = WalletMapper.toDomain(record);
    this.versions.set(wallet, record.version);
    return wallet;
  }

  protected toPersistence(entity: Wallet): PrismaWallet {
    return WalletMapper.toPersistence(entity);
  }

  async save(entity: Wallet): Promise<void> {
    const { id, balance } = this.toPersistence(entity);
    const knownVersion = this.versions.get(entity);

    await (knownVersion === undefined
      ? this.insert(entity, id, balance)
      : this.updateWithVersionCheck(entity, id, balance, knownVersion));

    this.domainEventBus.publishAll(entity.releaseEvents() as IEvent[]);
  }

  private async insert(
    entity: Wallet,
    id: string,
    balance: number,
  ): Promise<void> {
    try {
      const created = await this.prisma.wallet.create({
        data: { id, balance, version: 0 },
      });
      this.versions.set(entity, created.version);
    } catch (error) {
      // Another request opened the same wallet first — its row now exists,
      // so this insert lost the race. Surfacing it as a version conflict lets
      // the caller's retry loop re-read and continue as an update instead.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw WalletVersionConflict.forWallet(entity.id);
      }
      throw error;
    }
  }

  private async updateWithVersionCheck(
    entity: Wallet,
    id: string,
    balance: number,
    knownVersion: number,
  ): Promise<void> {
    const result = await this.prisma.wallet.updateMany({
      where: { id, version: knownVersion },
      data: { balance, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw WalletVersionConflict.forWallet(entity.id);
    }
    this.versions.set(entity, knownVersion + 1);
  }
}
