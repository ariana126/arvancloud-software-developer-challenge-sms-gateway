import { Wallet } from '@credit/domain/wallet.aggregate';
import { EntityRepository } from '@framework/domain';

export abstract class WalletRepository extends EntityRepository<Wallet> {
  /**
   * Persists the wallet's recorded changes as **deltas**, never as an absolute
   * balance — an implementation that writes `getBalance()` back would let two
   * concurrent writers each overwrite the other's subtraction, which is the one
   * failure this contract exists to rule out.
   *
   * A decrease must be applied only if the stored balance still covers it, in a
   * single statement, and must throw `InsufficientCredit` when it does not.
   * Callers rely on that: a balance that was sufficient when it was read is not
   * a promise that it still is, and this is the only place that difference can
   * be detected.
   */
  public abstract save(entity: Wallet): Promise<void>;
}
