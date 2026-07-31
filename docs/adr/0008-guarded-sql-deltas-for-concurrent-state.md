# 8. Write Concurrent State as Guarded SQL Deltas, Never Read-Modify-Write

## Status

Accepted — 2026-07-31 (`0522c2d`).

## Context

A wallet holds money and an SMS costs money. Two requests from the same customer can arrive at the
same instant, and the aggregate pattern makes the wrong thing natural: load the aggregate, call
`wallet.decrease(cost)`, save the aggregate.

Saving the aggregate means writing its whole state — `balance = 1000`. That is a lost update, and the
arithmetic is unforgiving. Two requests read a balance of 1000. Both subtract 800 in memory. Both
write 200. The customer paid for one SMS and received two. At scale it is not an edge case; it is
the behaviour under exactly the load that matters.

`PrismaEntityRepository`'s inherited `save()` is an upsert keyed on `id` — a whole-state write. It is
the default, and it is wrong for anything with more than one concurrent writer.

The options:

- **Optimistic locking with a version column.** Correct, and it makes every conflict an application
  concern: a retry loop, a decision about how many times, and a failure mode to surface to the
  client.
- **Pessimistic locking — `SELECT … FOR UPDATE` before the read.** Correct, and it serialises every
  writer on that row for the duration of the transaction, which is the whole request.
- **Serializable isolation.** Correct, and it converts contention into aborted transactions the
  application must retry.
- **A conditional write: express the change as a delta, guarded by the condition that must hold.**

The last one has a property the others do not. **A conditional write does not race** — there is no
window between reading and writing, because there is no read.

## Decision

We will never persist concurrent state as a whole value read into memory. Every such write is
expressed as a **conditional SQL delta** — a change relative to the current row, guarded by the
predicate that must hold — and a zero-row result is the signal that a concurrent writer got there
first.

`PrismaWalletRepository` translates the aggregate's recorded events into deltas rather than writing
`getBalance()`. An increase is `balance = balance + amount`. A decrease is `balance = balance -
amount` **guarded by `balance >= amount`**, and a zero-row result becomes `InsufficientCredit`.

**The guard is stated twice, on purpose.** `Wallet.decrease` fails fast in the domain with the numbers
a client needs to see; the SQL states the same rule again, because SQL is the only place a concurrent
writer can be seen at all. Neither is redundant: the aggregate reasons about the row it read, and a
row it read a moment ago is exactly what a racing writer invalidates.

There is no version column and no retry loop. Nothing to tune, nothing to give up on.

**The rule generalises past money**, and there are four instances of it:

1. **The wallet debit** — guarded by `balance >= amount`.
2. **The send transaction** — `SendSmsHandler` wraps the debit, the sender's traffic count, the
   `PENDING` message and the outbox row in one `UnitOfWork.execute`, so money can never be taken
   without a record of what it was taken for.
3. **The sender traffic counter** — `PrismaSenderTrafficRepository.recordSend` is a single
   `INSERT … ON CONFLICT DO UPDATE` whose `CASE` expressions both increment and roll an expired
   window over. A read-modify-write there loses increments under exactly the load that matters, and a
   heavy sender that undercounts itself stays in the shared dispatch lane and swamps the customers it
   was supposed to be separated from (ADR 11).
4. **The SMS message status** — see ADR 12, which is where the rule was broken and what it cost.

The business justification is that the failure mode is *giving away the product*. An SMS sent without
being paid for is direct revenue loss, it is invisible in the logs, and it is unrecoverable after the
fact — the message has already gone out.

## Consequences

Repositories carry raw or near-raw SQL rather than Prisma's ergonomic model API, and a reader has to
understand the statement to understand the rule. That is the cost of putting the rule where the race
is visible.

The domain-level guard and the SQL guard can drift apart. Nothing checks that `Wallet.decrease`'s
condition and the `WHERE` clause say the same thing.

A zero-row result is overloaded: it means "the guard failed" and also "the row is not there". Each
repository has to decide which, and that decision is implicit in the code.

Not everything needs this. A single-writer aggregate is perfectly safe with the inherited
whole-state upsert — which is precisely how ADR 12's defect happened. **The premise "this aggregate
has one writer" is a fact about the system that can stop being true without the repository
changing.** Adding a second writer to an aggregate is the moment to re-read this decision, and it is
the one trigger nothing here can automate.

## Compliance

Partly automated:

- `credit/infrastructure/persistence/wallet.repository.spec.ts` covers the guarded debit.
- `credit/domain/wallet.aggregate.spec.ts` covers the domain-level half.
- The acceptance scenario **"Two sends at the same moment cannot both spend the same credit"**
  (`acceptance-tests/specs/sms-sending/send-sms.feature`) exercises the race end to end, through the
  API, against a real Postgres. This is the strongest gate in the set — it fails if the guard is
  removed, regardless of which layer removed it.

Manual, and unavoidably so: the review trigger. When a second writer is added to an existing
aggregate, its repository must be re-examined. No linter can see that, because the thing that changed
is a premise, not a line of code.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-31 · Last modified: 2026-07-31

Related: ADR 12 is the fourth instance and the one that shows how the rule gets broken.
