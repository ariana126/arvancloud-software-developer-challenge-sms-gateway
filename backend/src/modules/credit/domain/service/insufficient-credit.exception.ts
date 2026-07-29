import { DomainException, Identity } from '@framework/domain';

/**
 * A wallet's balance does not cover a charge. Nothing is debited.
 *
 * **It lives under `domain/service/` because it is part of the published
 * `CreditLedger` contract — not because it is a service.** `domain/service/` is
 * the one directory another module may import (see `modules-isolated` in
 * `.dependency-cruiser.cjs`), and a caller in another module has to be able to
 * name this type in order to react to it. So it sits on the seam beside the
 * port that declares it, rather than in `domain/exception/` with
 * `WalletVersionConflict`, which is module-private.
 */
export class InsufficientCredit extends DomainException {
  private constructor(
    message: string,
    public readonly userId: Identity,
    public readonly required: number,
    public readonly available: number,
  ) {
    super(message);
  }

  public static forWallet(
    userId: Identity,
    required: number,
    available: number,
  ): InsufficientCredit {
    return new InsufficientCredit(
      `Wallet for user ${userId.asString()} holds ${available}, which does not cover a charge of ${required}.`,
      userId,
      required,
      available,
    );
  }
}
