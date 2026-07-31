import { Prisma } from '@prisma/client';

import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

/**
 * A `PrismaService` built from its prototype rather than its constructor: the
 * real one opens a driver adapter against `DATABASE_URL`, and these tests run
 * with no database behind them.
 *
 * Only `$transaction` is replaced. `client`, `runInTransaction` and
 * `inTransaction` are the genuine implementations, so what these tests exercise
 * is the real `AsyncLocalStorage` bookkeeping and not a re-statement of it.
 */
function prismaDouble(): {
  prisma: PrismaService;
  tx: Prisma.TransactionClient;
  transactionCalls: number;
} {
  const tx = { id: 'the-transaction' } as unknown as Prisma.TransactionClient;
  const service = Object.create(PrismaService.prototype) as PrismaService;
  const state = { transactionCalls: 0 };

  Object.assign(service, {
    $transaction: (
      work: (client: Prisma.TransactionClient) => Promise<unknown>,
    ) => {
      state.transactionCalls++;
      return work(tx);
    },
  });

  return {
    prisma: service,
    tx,
    get transactionCalls() {
      return state.transactionCalls;
    },
  };
}

describe('PrismaUnitOfWork', () => {
  it('runs the work inside a transaction and returns its result', async () => {
    const double = prismaDouble();
    const sut = new PrismaUnitOfWork(double.prisma);

    const result = await sut.execute(() => Promise.resolve('done'));

    expect(result).toBe('done');
    expect(double.transactionCalls).toBe(1);
  });

  it('makes the transaction the client repositories resolve to', async () => {
    const double = prismaDouble();
    const sut = new PrismaUnitOfWork(double.prisma);

    let seen: unknown;
    await sut.execute(() => {
      seen = double.prisma.client();
      return Promise.resolve();
    });

    expect(seen).toBe(double.tx);
  });

  it('leaves no transaction in force once the work is done', async () => {
    const double = prismaDouble();
    const sut = new PrismaUnitOfWork(double.prisma);

    await sut.execute(() => Promise.resolve());

    expect(double.prisma.inTransaction()).toBe(false);
    expect(double.prisma.client()).toBe(double.prisma);
  });

  /**
   * The re-entrancy rule the port documents. A second Prisma transaction opened
   * from inside the first would take a second connection and wait on row locks
   * the first is still holding — a self-inflicted deadlock. An inner call joins
   * instead, so there is one commit and the outermost caller owns it.
   */
  it('joins an open transaction rather than nesting a second one', async () => {
    const double = prismaDouble();
    const sut = new PrismaUnitOfWork(double.prisma);

    let seen: unknown;
    await sut.execute(() =>
      sut.execute(() => {
        seen = double.prisma.client();
        return Promise.resolve();
      }),
    );

    expect(double.transactionCalls).toBe(1);
    expect(seen).toBe(double.tx);
  });

  it('propagates a failure, so the transaction rolls back', async () => {
    const double = prismaDouble();
    const sut = new PrismaUnitOfWork(double.prisma);
    const failure = new Error('the write failed');

    await expect(sut.execute(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    expect(double.prisma.inTransaction()).toBe(false);
  });

  /**
   * Two overlapping requests, only one of them transactional. A field on the
   * singleton would have leaked the transaction into the other; the store is
   * per-call-chain, so it cannot.
   */
  it('does not leak the transaction into concurrent work outside it', async () => {
    const double = prismaDouble();
    const sut = new PrismaUnitOfWork(double.prisma);
    let outside: unknown;

    await Promise.all([
      sut.execute(() => new Promise((resolve) => setImmediate(resolve))),
      (async () => {
        await new Promise((resolve) => setImmediate(resolve));
        outside = double.prisma.client();
      })(),
    ]);

    expect(outside).toBe(double.prisma);
  });
});
