import { IncreaseCreditCommand } from '@credit/application/commands/increase-credit/increase-credit.command';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

/**
 * Linear, with no retry loop, for the same reason `WalletCreditLedger` has none:
 * the repository writes an increase as `balance = balance + amount`, which two
 * concurrent top-ups both apply without either being lost. Reading the wallet
 * first is what gives `Wallet.increase` the chance to reject a non-positive
 * amount and to record `CreditIncreased`.
 */
@CommandHandler(IncreaseCreditCommand)
export class IncreaseCreditHandler implements ICommandHandler<IncreaseCreditCommand> {
  constructor(private readonly walletRepository: WalletRepository) {}

  async execute(command: IncreaseCreditCommand): Promise<void> {
    const wallet =
      (await this.walletRepository.find(command.userId)) ??
      Wallet.open(command.userId);

    wallet.increase(command.amount);

    await this.walletRepository.save(wallet);
  }
}
