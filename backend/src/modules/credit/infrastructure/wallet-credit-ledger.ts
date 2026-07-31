import { CreditLedger } from '@credit/domain/service/credit-ledger';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';
import { Injectable } from '@nestjs/common';

/**
 * The published `CreditLedger`, served out of the wallet write model.
 *
 * Read the wallet, ask it to spend, save. There is no retry loop and no version
 * check, because `PrismaWalletRepository.save` turns the decrease into a single
 * guarded statement — the balance is tested and reduced in the same breath, by
 * the database — so two concurrent charges cannot both pass a check that was
 * true for each of them separately.
 *
 * The read still earns its round trip: it is what lets `Wallet.decrease` refuse
 * a charge the balance plainly cannot cover, with the required and available
 * amounts a client needs, before anything is written. When that read is stale —
 * the case where it matters — the guard inside `save` catches it and raises the
 * same `InsufficientCredit` from the numbers as they stand at that instant.
 */
@Injectable()
export class WalletCreditLedger extends CreditLedger {
  constructor(private readonly walletRepository: WalletRepository) {
    super();
  }

  async charge(userId: Identity, amountInRials: number): Promise<void> {
    // The seam carries a primitive; Money is reconstituted here, at the
    // boundary, so `credit` remains the only module that knows what a Rial is.
    const amount = Money.rials(amountInRials);

    // A wallet nobody has funded yet has no row. `Wallet.open` gives it a zero
    // balance, which `decrease` then rejects — the correct answer, and the
    // reason a charge never reaches the insert branch of `save`.
    const wallet =
      (await this.walletRepository.find(userId)) ?? Wallet.open(userId);

    wallet.decrease(amount);

    await this.walletRepository.save(wallet);
  }
}
