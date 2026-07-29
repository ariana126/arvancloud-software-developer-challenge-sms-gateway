import { ConcurrentModificationException } from '@credit/application/exceptions';
import { WalletVersionConflict } from '@credit/domain/exception/wallet-version-conflict.exception';
import { CreditLedger } from '@credit/domain/service/credit-ledger';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';
import { Injectable } from '@nestjs/common';

/**
 * The published `CreditLedger`, served out of the wallet write model.
 *
 * Safety here rests entirely on `PrismaWalletRepository.save` making the write
 * *conditional at the database* — an `updateMany` whose `where` carries the
 * version the wallet was read at, with a zero-row result raised as
 * `WalletVersionConflict`. An in-process version comparison followed by an
 * unconditional write would let two requests both read a sufficient balance and
 * both spend it. That is why a lost race is retried from a fresh read rather
 * than from the aggregate already in hand.
 */
@Injectable()
export class WalletCreditLedger extends CreditLedger {
  private static readonly MAX_ATTEMPTS = 3;

  constructor(private readonly walletRepository: WalletRepository) {
    super();
  }

  async charge(userId: Identity, amountInRials: number): Promise<void> {
    // The seam carries a primitive; Money is reconstituted here, at the
    // boundary, so `credit` remains the only module that knows what a Rial is.
    const amount = Money.rials(amountInRials);

    for (
      let attempt = 1;
      attempt <= WalletCreditLedger.MAX_ATTEMPTS;
      attempt++
    ) {
      // A wallet nobody has funded yet has no row. `Wallet.open` gives it a zero
      // balance, which `decrease` then rejects — the correct answer, and the
      // reason the insert branch of `save` is unreachable from `charge`. (It is
      // reachable from `IncreaseCreditHandler`, and the repository already
      // translates the colliding insert's unique-constraint violation into
      // `WalletVersionConflict`, so that path retries rather than escaping.)
      const wallet =
        (await this.walletRepository.find(userId)) ?? Wallet.open(userId);

      // Outside the try, and re-run on every attempt: a retry re-reads the
      // wallet, so a balance that covered the charge a moment ago may not any
      // more. `InsufficientCredit` propagates straight out — it is a verdict,
      // not a race, and retrying it would only produce the same answer.
      wallet.decrease(amount);

      try {
        await this.walletRepository.save(wallet);
        return;
      } catch (error) {
        if (!(error instanceof WalletVersionConflict)) {
          throw error;
        }
        if (attempt === WalletCreditLedger.MAX_ATTEMPTS) {
          // Three attempts is a policy, not a guarantee: under sustained
          // contention the caller gets a 409 and nothing has been charged.
          throw ConcurrentModificationException.forWallet(userId);
        }
        // Otherwise: loop again, re-reading the latest balance before retrying.
      }
    }
  }
}
