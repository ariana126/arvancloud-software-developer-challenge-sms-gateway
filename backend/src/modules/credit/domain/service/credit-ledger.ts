import { Identity } from '@framework/domain';

/**
 * What this module publishes to the rest of the application: the ability to
 * charge a user's credit, and nothing else. `domain/service/` is the only
 * directory another module may import (see `modules-isolated` in
 * `.dependency-cruiser.cjs`), so this port plus `InsufficientCredit` beside it
 * are the whole of credit's cross-module surface.
 */
export abstract class CreditLedger {
  /**
   * Debits `amountInRials` from the user's balance.
   *
   * Throws `InsufficientCredit` when the balance does not cover the charge, and
   * debits nothing in that case — the check precedes the subtraction, so a
   * rejected charge leaves the balance exactly as it was.
   *
   * The amount crosses as a plain integer of Rials rather than as `Money`,
   * because `Money` lives in this module's `domain/value/` and is not part of
   * the published surface. Implementations reconstitute it at the boundary.
   */
  public abstract charge(
    userId: Identity,
    amountInRials: number,
  ): Promise<void>;
}
