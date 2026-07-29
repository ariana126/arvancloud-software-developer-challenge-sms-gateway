import { IncreaseCreditCommand } from '@credit/application/commands/increase-credit/increase-credit.command';
import { ConcurrentModificationException } from '@credit/application/exceptions';
import { WalletVersionConflict } from '@credit/domain/exception/wallet-version-conflict.exception';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

@CommandHandler(IncreaseCreditCommand)
export class IncreaseCreditHandler implements ICommandHandler<IncreaseCreditCommand> {
  private static readonly MAX_ATTEMPTS = 3;

  constructor(private readonly walletRepository: WalletRepository) {}

  async execute(command: IncreaseCreditCommand): Promise<void> {
    for (
      let attempt = 1;
      attempt <= IncreaseCreditHandler.MAX_ATTEMPTS;
      attempt++
    ) {
      const wallet =
        (await this.walletRepository.find(command.userId)) ??
        Wallet.open(command.userId);
      wallet.increase(command.amount);

      try {
        await this.walletRepository.save(wallet);
        return;
      } catch (error) {
        if (!(error instanceof WalletVersionConflict)) {
          throw error;
        }
        if (attempt === IncreaseCreditHandler.MAX_ATTEMPTS) {
          throw ConcurrentModificationException.forWallet(command.userId);
        }
        // Otherwise: loop again, re-reading the latest wallet state before retrying.
      }
    }
  }
}
