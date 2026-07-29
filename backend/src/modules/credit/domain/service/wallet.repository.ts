import { Wallet } from '@credit/domain/wallet.aggregate';
import { EntityRepository } from '@framework/domain';

export abstract class WalletRepository extends EntityRepository<Wallet> {
  /**
   * Persists the wallet. Implementations guard against a lost update under
   * concurrent writes (e.g. an optimistic-concurrency version check) and are
   * expected to reject a losing write by throwing `WalletVersionConflict`
   * rather than silently overwriting a newer balance. Callers that mutate and
   * save in a loop (see `IncreaseCreditHandler`) rely on this to know when to
   * retry.
   */
  public abstract save(entity: Wallet): Promise<void>;
}
