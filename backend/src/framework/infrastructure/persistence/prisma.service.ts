import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * The transaction currently in force, if any.
   *
   * `AsyncLocalStorage` rather than a field, because a field would be shared by
   * every concurrent request this singleton serves — one request opening a
   * transaction would silently enrol another's writes into it. The store follows
   * the async call chain instead, so it is scoped to one `UnitOfWork.execute`,
   * and a request outside any transaction simply finds nothing here.
   */
  private static readonly transaction =
    new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    super({ adapter });
  }

  /**
   * The client every repository should read and write through — the ambient
   * transaction when one is open, otherwise this connection.
   *
   * Reaching for `this.<model>` directly is the mistake this method exists to
   * prevent: it bypasses the transaction, so the write commits on its own and no
   * rollback can take it back.
   */
  public client(): Prisma.TransactionClient {
    return PrismaService.transaction.getStore() ?? this;
  }

  /** Makes `tx` the ambient transaction for the duration of `work`. */
  public runInTransaction<T>(
    tx: Prisma.TransactionClient,
    work: () => Promise<T>,
  ): Promise<T> {
    return PrismaService.transaction.run(tx, work);
  }

  /** Whether a transaction is already in force on this call chain. */
  public inTransaction(): boolean {
    return PrismaService.transaction.getStore() !== undefined;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
