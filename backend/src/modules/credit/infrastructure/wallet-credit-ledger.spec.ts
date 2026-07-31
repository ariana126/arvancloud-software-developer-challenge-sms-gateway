import { CreditDecreased } from '@credit/domain/events/credit-decreased.event';
import { CreditIncreased } from '@credit/domain/events/credit-increased.event';
import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';

import { WalletCreditLedger } from './wallet-credit-ledger';

const COST_PER_SMS = 1000;

/**
 * Models the database, not a cache — and in particular models the **guard**.
 *
 * `find` reconstructs a fresh `Wallet` from the stored balance, the way a real
 * repository deserializes a row. `save` applies the aggregate's recorded events
 * as deltas against whatever is stored *now*, refusing a decrease the stored
 * balance no longer covers, exactly as `PrismaWalletRepository` has Postgres do.
 *
 * A fake that instead accepted `entity.getBalance()` would pass every test below
 * while the real thing lost money, so this fidelity is the point of it.
 */
class FakeWalletRepository extends WalletRepository {
  public readonly saved: Wallet[] = [];
  public reads = 0;
  /** Runs just before a save is applied — stands in for a competing writer. */
  public beforeSave: (() => void) | null = null;

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
    this.beforeSave?.();

    const current = this.storedBalance ?? Money.rials(0);
    let next = current;

    for (const event of entity.releaseEvents()) {
      if (event instanceof CreditIncreased) {
        next = next.add(Money.rials(event.amount));
      }
      if (event instanceof CreditDecreased) {
        const amount = Money.rials(event.amount);
        if (!next.isAtLeast(amount)) {
          return Promise.reject(
            InsufficientCredit.forWallet(
              entity.id,
              event.amount,
              next.asRials(),
            ),
          );
        }
        next = next.subtract(amount);
      }
    }

    this.storedBalance = next;
    this.saved.push(entity);
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

    expect(repository.currentBalance()?.equals(Money.rials(9000))).toBe(true);
  });

  it('spending the last of the credit is allowed, and lands on zero', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(1000));
    const sut = new WalletCreditLedger(repository);

    await sut.charge(userId, COST_PER_SMS);

    expect(repository.currentBalance()?.equals(Money.rials(0))).toBe(true);
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

  /**
   * One read and one write, on both the accepted and the rejected path. Pinned
   * because the previous design spent two of each to reach the same answers, and
   * a retry loop creeping back in is exactly the regression worth catching.
   */
  it('reads once and writes once, with no retry loop', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(10_000));
    const sut = new WalletCreditLedger(repository);

    await sut.charge(userId, COST_PER_SMS);

    expect(repository.reads).toBe(1);
    expect(repository.saved).toHaveLength(1);
  });

  /**
   * The interleaving the whole design exists for: the balance covered the charge
   * when it was read, a competing writer drained it before the write landed, and
   * the guard — not the aggregate — is what catches it. The rejection carries the
   * balance as it stands at that instant, not the stale one.
   */
  it('a charge that loses the race is refused by the guard, against the drained balance', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(1000));
    repository.beforeSave = () => repository.drainTo(Money.rials(0));
    const sut = new WalletCreditLedger(repository);

    const rejection = (await sut
      .charge(userId, COST_PER_SMS)
      .catch((error: unknown) => error)) as InsufficientCredit;

    expect(rejection).toBeInstanceOf(InsufficientCredit);
    expect(rejection.available).toBe(0);
    expect(rejection.required).toBe(COST_PER_SMS);
    expect(repository.saved).toHaveLength(0);
  });

  /**
   * Both requests read the same 1000 before either writes — the lost-update
   * setup. Exactly one may be charged, the other must be told why, and the
   * balance must land on 0 rather than going negative.
   */
  it('two concurrent charges cannot both succeed against a balance that covers only one', async () => {
    const userId = Identity.new();
    const repository = new FakeWalletRepository(userId, Money.rials(1000));
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
    expect(rejected[0]).toBeInstanceOf(InsufficientCredit);
    expect(repository.saved).toHaveLength(1);
    expect(repository.currentBalance()?.equals(Money.rials(0))).toBe(true);
  });

  it('propagates any other save failure untouched', async () => {
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
