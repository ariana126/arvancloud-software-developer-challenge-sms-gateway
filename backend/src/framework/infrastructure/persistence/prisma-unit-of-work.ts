import { UnitOfWork } from '@framework/domain/service/unit-of-work';
import { Injectable } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * `UnitOfWork` over a Prisma interactive transaction.
 *
 * The port is imported from its own module rather than from `@framework/domain`
 * — a file under `framework/` importing its own package's barrel is a load-order
 * cycle that crashes at runtime, which is what `no-own-package-barrel` exists to
 * catch.
 *
 * **Re-entrant by joining, not by nesting.** Postgres has savepoints but Prisma
 * does not expose them, so an inner `$transaction` on an already-transactional
 * client would be a second connection deadlocking against the first. An
 * `execute` that finds a transaction already in force therefore runs the work
 * inside it: the outermost call owns the commit, and an inner failure rolls the
 * whole thing back. That is the behaviour a caller of the port is told to
 * assume.
 */
@Injectable()
export class PrismaUnitOfWork extends UnitOfWork {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  public execute<T>(work: () => Promise<T>): Promise<T> {
    if (this.prisma.inTransaction()) {
      return work();
    }

    return this.prisma.$transaction((tx) =>
      this.prisma.runInTransaction(tx, work),
    );
  }
}
