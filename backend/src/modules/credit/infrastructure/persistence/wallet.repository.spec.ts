import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';
import { PrismaService } from '@framework/infrastructure';
import { EventBus } from '@nestjs/cqrs';

import { PrismaWalletRepository } from './wallet.repository';

function fakePrisma(): {
  prisma: PrismaService;
  wallet: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
  };
} {
  const wallet = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  };
  // Every read and write resolves through `client()`, so the double answers it
  // with the same model object a transaction would have handed back.
  const prisma = {
    wallet,
    client: () => ({ wallet }),
  } as unknown as PrismaService;

  return { prisma, wallet };
}

function fakeEventBus(): { eventBus: EventBus; publishAll: jest.Mock } {
  const publishAll = jest.fn();
  return { eventBus: { publishAll } as unknown as EventBus, publishAll };
}

const USER_ID = 'user-1';

function walletOf(balance: number): Wallet {
  return new Wallet(Identity.fromString(USER_ID), Money.rials(balance));
}

describe('PrismaWalletRepository', () => {
  it('writes an increase as an increment, so a concurrent top-up is not lost', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(10_000);
    account.increase(Money.rials(50_000));

    await sut.save(account);

    expect(wallet.upsert).toHaveBeenCalledWith({
      where: { id: USER_ID },
      create: { id: USER_ID, balance: 50_000 },
      update: { balance: { increment: 50_000 } },
    });
  });

  /**
   * The heart of it. The sufficiency check rides in the `where`, so the database
   * decides — an unguarded update, or one writing the aggregate's own computed
   * balance, is what lets two requests spend the same money.
   */
  it('writes a decrease as a decrement guarded by the stored balance', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    wallet.updateMany.mockResolvedValue({ count: 1 });
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(10_000);
    account.decrease(Money.rials(1000));

    await sut.save(account);

    expect(wallet.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, balance: { gte: 1000 } },
      data: { balance: { decrement: 1000 } },
    });
    expect(wallet.upsert).not.toHaveBeenCalled();
  });

  /**
   * The race, from the loser's side: the balance covered the charge when it was
   * read and no longer does, so the guard matches no row.
   */
  it('rejects a decrease the guard refuses', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    wallet.updateMany.mockResolvedValue({ count: 0 });
    wallet.findUnique.mockResolvedValue({ id: USER_ID, balance: 0 });
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(1000);
    account.decrease(Money.rials(1000));

    await expect(sut.save(account)).rejects.toBeInstanceOf(InsufficientCredit);
  });

  it('reports required and available as they stand at the refusal', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    wallet.updateMany.mockResolvedValue({ count: 0 });
    wallet.findUnique.mockResolvedValue({ id: USER_ID, balance: 400 });
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(1000);
    account.decrease(Money.rials(1000));

    const error = await sut
      .save(account)
      .catch((error_: unknown) => error_ as InsufficientCredit);

    expect(error).toMatchObject({ required: 1000, available: 400 });
  });

  it('reports a balance of 0 when the refused wallet has no row at all', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    wallet.updateMany.mockResolvedValue({ count: 0 });
    wallet.findUnique.mockResolvedValue(null);
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(1000);
    account.decrease(Money.rials(1000));

    const error = await sut
      .save(account)
      .catch((error_: unknown) => error_ as InsufficientCredit);

    expect(error).toMatchObject({ available: 0 });
  });

  it('publishes the recorded events once the write has landed', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus, publishAll } = fakeEventBus();
    wallet.updateMany.mockResolvedValue({ count: 1 });
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(10_000);
    account.decrease(Money.rials(1000));

    await sut.save(account);

    expect(publishAll).toHaveBeenCalledTimes(1);
    expect(publishAll).toHaveBeenCalledWith(
      expect.arrayContaining([expect.anything()]),
    );
  });

  /**
   * Announcing a debit the database refused would tell the rest of the system
   * money moved when none did.
   */
  it('publishes nothing when the write was refused', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus, publishAll } = fakeEventBus();
    wallet.updateMany.mockResolvedValue({ count: 0 });
    wallet.findUnique.mockResolvedValue({ id: USER_ID, balance: 0 });
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(1000);
    account.decrease(Money.rials(1000));

    await expect(sut.save(account)).rejects.toBeInstanceOf(InsufficientCredit);

    expect(publishAll).not.toHaveBeenCalled();
  });

  it('writes nothing for a wallet carrying no recorded change', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    const sut = new PrismaWalletRepository(prisma, eventBus);

    await sut.save(Wallet.open(Identity.fromString(USER_ID)));

    expect(wallet.upsert).not.toHaveBeenCalled();
    expect(wallet.updateMany).not.toHaveBeenCalled();
  });

  it('applies every recorded change', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    wallet.updateMany.mockResolvedValue({ count: 1 });
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(0);
    account.increase(Money.rials(5000));
    account.decrease(Money.rials(1000));

    await sut.save(account);

    expect(wallet.upsert).toHaveBeenCalledTimes(1);
    expect(wallet.updateMany).toHaveBeenCalledTimes(1);
  });

  it('propagates an unrelated database failure untouched', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    const failure = new Error('connection lost');
    wallet.updateMany.mockRejectedValue(failure);
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const account = walletOf(10_000);
    account.decrease(Money.rials(1000));

    await expect(sut.save(account)).rejects.toBe(failure);
  });

  it('reads a wallet back through the mapper', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    wallet.findUnique.mockResolvedValue({ id: USER_ID, balance: 7000 });
    const sut = new PrismaWalletRepository(prisma, eventBus);

    const found = await sut.find(Identity.fromString(USER_ID));

    expect(found?.getBalance().equals(Money.rials(7000))).toBe(true);
  });

  it('returns null for a wallet that has never been funded', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    wallet.findUnique.mockResolvedValue(null);
    const sut = new PrismaWalletRepository(prisma, eventBus);

    expect(await sut.find(Identity.fromString(USER_ID))).toBeNull();
  });
});
