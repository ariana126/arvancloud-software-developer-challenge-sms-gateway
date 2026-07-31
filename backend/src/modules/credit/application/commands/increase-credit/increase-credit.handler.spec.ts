import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';

import { IncreaseCreditCommand } from './increase-credit.command';
import { IncreaseCreditHandler } from './increase-credit.handler';

class FakeWalletRepository extends WalletRepository {
  public saved: Wallet[] = [];
  private storedBalance: Money | null;

  constructor(
    private readonly userId: Identity,
    initial: Wallet | null,
  ) {
    super();
    this.storedBalance = initial ? initial.getBalance() : null;
  }

  // Reconstructs a fresh Wallet from the persisted balance on every call, the
  // way a real repository deserializes a row.
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

  /**
   * There is no retry here to test, and that is the point worth pinning: the
   * repository applies an increase as `balance = balance + amount`, so two
   * concurrent top-ups both land and neither needs to detect the other. What
   * the handler must still do is save exactly once.
   */
  it('saves once, with no retry loop around it', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Wallet.open(userId));
    const saveSpy = jest.spyOn(repository, 'save');
    const sut = new IncreaseCreditHandler(repository);

    await sut.execute(new IncreaseCreditCommand(userId, Money.rials(1000)));

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('records the increase as a domain event for the repository to apply', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Wallet.open(userId));
    const sut = new IncreaseCreditHandler(repository);

    await sut.execute(new IncreaseCreditCommand(userId, Money.rials(1000)));

    expect(repository.saved[0].releaseEvents()).toHaveLength(1);
  });

  it('propagates a failure to save', async () => {
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
