import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';

import { GetWalletBalanceHandler } from './get-wallet-balance.handler';
import { GetWalletBalanceQuery } from './get-wallet-balance.query';

class FakeWalletRepository extends WalletRepository {
  constructor(private wallet: Wallet | null) {
    super();
  }

  find(): Promise<Wallet | null> {
    return Promise.resolve(this.wallet);
  }

  get(): Promise<Wallet> {
    if (!this.wallet) throw new Error('not found');
    return Promise.resolve(this.wallet);
  }

  save(entity: Wallet): Promise<void> {
    this.wallet = entity;
    return Promise.resolve();
  }
}

describe('GetWalletBalanceHandler', () => {
  it('reports a balance of 0 for a user with no wallet yet', async () => {
    const repository = new FakeWalletRepository(null);
    const sut = new GetWalletBalanceHandler(repository);

    const result = await sut.execute(new GetWalletBalanceQuery(Identity.new()));

    expect(result.amount).toBe(0);
  });

  it("reports the wallet's current balance in Rials", async () => {
    const userId = Identity.new();
    const wallet = Wallet.open(userId);
    wallet.increase(Money.rials(50_000));
    const repository = new FakeWalletRepository(wallet);
    const sut = new GetWalletBalanceHandler(repository);

    const result = await sut.execute(new GetWalletBalanceQuery(userId));

    expect(result.amount).toBe(50_000);
  });
});
