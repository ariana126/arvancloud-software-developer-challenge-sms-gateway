/**
 * Runs a piece of work so that everything it writes commits together or not at
 * all.
 *
 * The port carries **no transaction handle**, and that is the whole design. A
 * handle would have to be a Prisma type, which the domain layer may not name
 * (`.dependency-cruiser.cjs`, `domain-pure`), and it would have to be threaded
 * through every port a transactional use case touches — including
 * `CreditLedger`, whose published surface is deliberately two methods wide. So
 * the transaction is *ambient* instead: the implementation makes it the current
 * one for the duration of `work`, and repositories pick it up without being
 * told. `SendSmsHandler` is the case that bought this — it debits a wallet and
 * writes two SMS rows, across two modules, in one transaction.
 *
 * Nesting is the implementation's business, not the caller's. Callers should
 * assume `execute` may be re-entered and must not rely on an inner call
 * committing on its own.
 */
export abstract class UnitOfWork {
  public abstract execute<T>(work: () => Promise<T>): Promise<T>;
}
