import { ConcurrentModificationException } from '@credit/application/exceptions';
import { WalletVersionConflict } from '@credit/domain/exception/wallet-version-conflict.exception';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';

import { IncreaseCreditCommand } from './increase-credit.command';
import { IncreaseCreditHandler } from './increase-credit.handler';

class FakeWalletRepository extends WalletRepository {
  public saved: Wallet[] = [];
  public saveOutcomes: Array<'ok' | 'conflict'> = [];
  private storedBalance: Money | null;

  constructor(
    private readonly userId: Identity,
    initial: Wallet | null,
  ) {
    super();
    this.storedBalance = initial ? initial.getBalance() : null;
  }

  // Reconstructs a fresh Wallet from the persisted balance on every call, the
  // way a real repository would deserialize from storage — a stored increase()
  // must never mutate an in-memory object a failed save() leaves behind.
  find(): Promise<Wallet | null> {
    return Promise.resolve(
      this.storedBalance ? new Wallet(this.userId, this.storedBalance) : null,
    );
  }

  async get(): Promise<Wallet> {
    const wallet = await this.find();
    if (!wallet) throw new Error('not found');
    return wallet;
  }

  save(entity: Wallet): Promise<void> {
    const outcome = this.saveOutcomes.shift() ?? 'ok';
    if (outcome === 'conflict') {
      return Promise.reject(WalletVersionConflict.forWallet(entity.id));
    }
    this.saved.push(entity);
    this.storedBalance = entity.getBalance();
    return Promise.resolve();
  }
}

describe('IncreaseCreditHandler', () => {
  it('opens a new wallet and increases it when none exists yet', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, null);
    const sut = new IncreaseCreditHandler(repository);

    await sut.execute(new IncreaseCreditCommand(userId, Money.rials(50_000)));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].getBalance().equals(Money.rials(50_000))).toBe(
      true,
    );
  });

  it('increases the balance of an existing wallet', async () => {
    const userId = Identity.new();
    const existing = Wallet.open(userId);
    existing.increase(Money.rials(10_000));
    existing.releaseEvents();
    const repository = new FakeWalletRepository(userId, existing);
    const sut = new IncreaseCreditHandler(repository);

    await sut.execute(new IncreaseCreditCommand(userId, Money.rials(5000)));

    expect(repository.saved[0].getBalance().equals(Money.rials(15_000))).toBe(
      true,
    );
  });

  it('retries by re-reading the wallet after a version conflict, then succeeds', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Wallet.open(userId));
    repository.saveOutcomes = ['conflict', 'ok'];
    const sut = new IncreaseCreditHandler(repository);

    await sut.execute(new IncreaseCreditCommand(userId, Money.rials(1000)));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].getBalance().equals(Money.rials(1000))).toBe(
      true,
    );
  });

  it('gives up after exhausting all attempts and throws ConcurrentModificationException', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Wallet.open(userId));
    repository.saveOutcomes = ['conflict', 'conflict', 'conflict'];
    const sut = new IncreaseCreditHandler(repository);

    await expect(
      sut.execute(new IncreaseCreditCommand(userId, Money.rials(1000))),
    ).rejects.toBeInstanceOf(ConcurrentModificationException);
    expect(repository.saved).toHaveLength(0);
  });

  it('propagates any other error immediately, without retrying', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Wallet.open(userId));
    const unexpectedError = new Error('database is unreachable');
    const saveSpy = jest.fn<Promise<void>, [Wallet]>(() =>
      Promise.reject(unexpectedError),
    );
    repository.save = saveSpy;
    const sut = new IncreaseCreditHandler(repository);

    await expect(
      sut.execute(new IncreaseCreditCommand(userId, Money.rials(1000))),
    ).rejects.toBe(unexpectedError);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});
