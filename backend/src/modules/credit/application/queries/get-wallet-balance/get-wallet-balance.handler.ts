import { GetWalletBalanceQuery } from '@credit/application/queries/get-wallet-balance/get-wallet-balance.query';
import { WalletBalanceReadModel } from '@credit/application/queries/get-wallet-balance/wallet-balance.read-model';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

@QueryHandler(GetWalletBalanceQuery)
export class GetWalletBalanceHandler implements IQueryHandler<
  GetWalletBalanceQuery,
  WalletBalanceReadModel
> {
  constructor(private readonly walletRepository: WalletRepository) {}

  async execute(query: GetWalletBalanceQuery): Promise<WalletBalanceReadModel> {
    // Resolves through the write-side WalletRepository rather than a
    // dedicated read port, same as GetUserByIdHandler in identity — the
    // established (if not yet ideal) pattern for this codebase's read side.
    // `find` rather than `get`: a user with no wallet row yet is the expected
    // case (nothing has increased their credit), not a not-found error, so it
    // must not throw — it reports a balance of 0.
    const wallet = await this.walletRepository.find(query.userId);
    const amount = wallet ? wallet.getBalance().asRials() : 0;
    return new WalletBalanceReadModel(amount);
  }
}
