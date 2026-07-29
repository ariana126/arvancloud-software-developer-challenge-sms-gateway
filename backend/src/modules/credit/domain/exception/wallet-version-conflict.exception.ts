import { DomainException, Identity } from '@framework/domain';

export class WalletVersionConflict extends DomainException {
  private constructor(
    message: string,
    public readonly userId: Identity,
  ) {
    super(message);
  }

  public static forWallet(userId: Identity): WalletVersionConflict {
    return new WalletVersionConflict(
      `Wallet for user ${userId.asString()} was modified concurrently.`,
      userId,
    );
  }
}
