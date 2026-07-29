import { ConcurrentModificationException } from '@credit/application/exceptions';
import { WalletVersionConflict } from '@credit/domain/exception/wallet-version-conflict.exception';
import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';

import { WalletCreditLedger } from './wallet-credit-ledger';

const COST_PER_SMS = 1000;

/**
 * Models the database, not a cache. Every `find` reconstructs a fresh `Wallet`
 * from the stored balance, the way a real repository deserializes a row — so a
 * retry that re-reads sees whatever a competing writer left behind, and a fake
 * that handed back a stale in-memory aggregate would fail the interleaving
 * tests below.
 */
class FakeWalletRepository extends WalletRepository {
  public readonly saved: Wallet[] = [];
  public saveOutcomes: Array<'ok' | 'conflict'> = [];
  public reads = 0;
  /** Runs when a save is rejected — stands in for the writer that won the race. */
  public onConflict: (() => void) | null = null;

  constructor(
    private readonly userId: Identity,
    private storedBalance: Money | null,
  ) {
    super();
  }

  find(): Promise<Wallet | null> {
    this.reads++;
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
      this.onConflict?.();
      return Promise.reject(WalletVersionConflict.forWallet(entity.id));
    }
    this.saved.push(entity);
    this.storedBalance = entity.getBalance();
    return Promise.resolve();
  }

  public drainTo(balance: Money): void {
    this.storedBalance = balance;
  }

  public currentBalance(): Money | null {
    return this.storedBalance;
  }
}

describe('WalletCreditLedger', () => {
  it('charging debits the wallet by the amount', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(10_000));
    const sut = new WalletCreditLedger(repository);

    await sut.charge(userId, COST_PER_SMS);

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].getBalance().equals(Money.rials(9000))).toBe(
      true,
    );
  });

  it('charging against a wallet nobody has funded is rejected as insufficient credit', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, null);
    const sut = new WalletCreditLedger(repository);

    await expect(sut.charge(userId, COST_PER_SMS)).rejects.toBeInstanceOf(
      InsufficientCredit,
    );

    expect(repository.saved).toHaveLength(0);
  });

  it('a balance that does not cover the charge is rejected and saves nothing', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(999));
    const sut = new WalletCreditLedger(repository);

    await expect(sut.charge(userId, COST_PER_SMS)).rejects.toBeInstanceOf(
      InsufficientCredit,
    );

    expect(repository.saved).toHaveLength(0);
    expect(repository.currentBalance()?.equals(Money.rials(999))).toBe(true);
  });

  it('a lost write is retried against a re-read wallet, and then succeeds', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(10_000));
    repository.saveOutcomes = ['conflict', 'ok'];
    const sut = new WalletCreditLedger(repository);

    await sut.charge(userId, COST_PER_SMS);

    expect(repository.reads).toBe(2);
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].getBalance().equals(Money.rials(9000))).toBe(
      true,
    );
  });

  // The interleaving the whole design exists for: attempt 1 reads a balance that
  // covers the charge, a competing writer drains it and bumps the version, the
  // conditional write is rejected, and attempt 2 must decide against the *drained*
  // balance rather than the one it started from.
  it('a charge that loses the race re-reads the drained balance and is rejected', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(1000));
    repository.saveOutcomes = ['conflict'];
    repository.onConflict = () => repository.drainTo(Money.rials(0));
    const sut = new WalletCreditLedger(repository);

    const rejection = (await sut
      .charge(userId, COST_PER_SMS)
      .catch((error: unknown) => error)) as InsufficientCredit;

    expect(rejection).toBeInstanceOf(InsufficientCredit);
    // The balance it judged against was the post-drain one, not the stale 1000.
    expect(rejection.available).toBe(0);
    expect(rejection.required).toBe(COST_PER_SMS);
    expect(repository.reads).toBe(2);
    expect(repository.saved).toHaveLength(0);
  });

  it('two concurrent sends cannot both succeed against a balance that covers only one', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(1000));
    // Both requests read the same 1000 before either writes; the database
    // accepts the first conditional write and rejects the second.
    repository.saveOutcomes = ['ok', 'conflict'];
    const sut = new WalletCreditLedger(repository);

    const outcomes = await Promise.all([
      sut
        .charge(userId, COST_PER_SMS)
        .then(() => 'charged' as const)
        .catch((error: unknown) => error),
      sut
        .charge(userId, COST_PER_SMS)
        .then(() => 'charged' as const)
        .catch((error: unknown) => error),
    ]);

    const charged = outcomes.filter((outcome) => outcome === 'charged');
    const rejected = outcomes.filter((outcome) => outcome !== 'charged');
    expect(charged).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      rejected[0] instanceof InsufficientCredit ||
        rejected[0] instanceof ConcurrentModificationException,
    ).toBe(true);
    expect(repository.saved).toHaveLength(1);
    expect(repository.currentBalance()?.equals(Money.rials(0))).toBe(true);
  });

  it('gives up after three contended attempts, having charged nothing', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(10_000));
    repository.saveOutcomes = ['conflict', 'conflict', 'conflict'];
    const sut = new WalletCreditLedger(repository);

    await expect(sut.charge(userId, COST_PER_SMS)).rejects.toBeInstanceOf(
      ConcurrentModificationException,
    );

    expect(repository.saved).toHaveLength(0);
    expect(repository.currentBalance()?.equals(Money.rials(10_000))).toBe(true);
  });

  it('any other save failure propagates immediately, without retrying', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(10_000));
    const unexpectedError = new Error('database is unreachable');
    const saveSpy = jest.fn<Promise<void>, [Wallet]>(() =>
      Promise.reject(unexpectedError),
    );
    repository.save = saveSpy;
    const sut = new WalletCreditLedger(repository);

    await expect(sut.charge(userId, COST_PER_SMS)).rejects.toBe(
      unexpectedError,
    );

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});
