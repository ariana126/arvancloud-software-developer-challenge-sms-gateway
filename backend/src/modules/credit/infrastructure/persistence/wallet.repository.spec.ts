import { WalletVersionConflict } from '@credit/domain/exception/wallet-version-conflict.exception';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';
import { PrismaService } from '@framework/infrastructure';
import { EventBus } from '@nestjs/cqrs';
import { Prisma, Wallet as PrismaWallet } from '@prisma/client';

import { PrismaWalletRepository } from './wallet.repository';

function fakePrisma(): {
  prisma: PrismaService;
  wallet: {
    findUnique: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
} {
  const wallet = {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  };
  return { prisma: { wallet } as unknown as PrismaService, wallet };
}

function fakeEventBus(): { eventBus: EventBus; publishAll: jest.Mock } {
  const publishAll = jest.fn();
  return { eventBus: { publishAll } as unknown as EventBus, publishAll };
}

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
    code,
    clientVersion: 'test',
  });
}

describe('PrismaWalletRepository', () => {
  it('inserts a brand-new wallet (never loaded) at version 0', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus, publishAll } = fakeEventBus();
    wallet.create.mockResolvedValue({
      id: 'user-1',
      balance: 50_000,
      version: 0,
    });
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const newWallet = Wallet.open(Identity.fromString('user-1'));
    newWallet.increase(Money.rials(50_000));

    await sut.save(newWallet);

    expect(wallet.create).toHaveBeenCalledWith({
      data: { id: 'user-1', balance: 50_000, version: 0 },
    });
    expect(wallet.updateMany).not.toHaveBeenCalled();
    expect(publishAll).toHaveBeenCalledTimes(1);
  });

  it('translates a colliding insert (unique constraint violation) into WalletVersionConflict', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus, publishAll } = fakeEventBus();
    wallet.create.mockRejectedValue(knownRequestError('P2002'));
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const newWallet = Wallet.open(Identity.fromString('user-1'));
    newWallet.increase(Money.rials(1000));

    await expect(sut.save(newWallet)).rejects.toBeInstanceOf(
      WalletVersionConflict,
    );
    expect(publishAll).not.toHaveBeenCalled();
  });

  it('propagates an unrelated insert failure without treating it as a conflict', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    const unexpectedError = new Error('connection refused');
    wallet.create.mockRejectedValue(unexpectedError);
    const sut = new PrismaWalletRepository(prisma, eventBus);
    const newWallet = Wallet.open(Identity.fromString('user-1'));
    newWallet.increase(Money.rials(1000));

    await expect(sut.save(newWallet)).rejects.toBe(unexpectedError);
  });

  it('updates a previously-loaded wallet with a version-conditional write', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus, publishAll } = fakeEventBus();
    const record: PrismaWallet = { id: 'user-1', balance: 10_000, version: 4 };
    wallet.findUnique.mockResolvedValue(record);
    wallet.updateMany.mockResolvedValue({ count: 1 });
    const sut = new PrismaWalletRepository(prisma, eventBus);

    const loaded = await sut.find(Identity.fromString('user-1'));
    loaded!.increase(Money.rials(5000));
    await sut.save(loaded!);

    expect(wallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', version: 4 },
      data: { balance: 15_000, version: { increment: 1 } },
    });
    expect(wallet.create).not.toHaveBeenCalled();
    expect(publishAll).toHaveBeenCalledTimes(1);
  });

  it('throws WalletVersionConflict when the conditional update affects no rows', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus, publishAll } = fakeEventBus();
    const record: PrismaWallet = { id: 'user-1', balance: 10_000, version: 4 };
    wallet.findUnique.mockResolvedValue(record);
    wallet.updateMany.mockResolvedValue({ count: 0 });
    const sut = new PrismaWalletRepository(prisma, eventBus);

    const loaded = await sut.find(Identity.fromString('user-1'));
    loaded!.increase(Money.rials(5000));

    await expect(sut.save(loaded!)).rejects.toBeInstanceOf(
      WalletVersionConflict,
    );
    expect(publishAll).not.toHaveBeenCalled();
  });

  it('propagates an unrelated update failure without treating it as a conflict', async () => {
    const { prisma, wallet } = fakePrisma();
    const { eventBus } = fakeEventBus();
    const record: PrismaWallet = { id: 'user-1', balance: 10_000, version: 4 };
    wallet.findUnique.mockResolvedValue(record);
    const unexpectedError = new Error('connection refused');
    wallet.updateMany.mockRejectedValue(unexpectedError);
    const sut = new PrismaWalletRepository(prisma, eventBus);

    const loaded = await sut.find(Identity.fromString('user-1'));
    loaded!.increase(Money.rials(5000));

    await expect(sut.save(loaded!)).rejects.toBe(unexpectedError);
  });
});
