# 9. Dispatch Through a Transactional Outbox, With the Broker Outside the Transaction

## Status

Accepted — 2026-07-31 (`0522c2d`). Superseded in part by 12.

## Context

Sending an SMS does two things that must both happen or neither: it takes the customer's money, and
it hands the message to something that will deliver it. One is a database write, the other is a call
to a system with its own network and its own opinions about being available.

The original arrangement was `charge → deliver → save`. Its failure mode was known and documented as
accepted: a carrier that took the message and a process that died before saving left money taken for
a message nobody recorded, and no way to find it afterwards.

Producing to a broker directly from the command handler does not fix this — it makes it worse. That
is a **dual write** across Postgres and the broker with no transaction spanning them. The charge
commits and the produce fails, or the produce succeeds and the transaction rolls back. There is no
ordering of the two that is safe, because the failure can land between them.

Holding a database transaction open across the broker call is the other obvious idea, and it trades
one problem for a worse one: a wallet row stays locked for as long as someone else's network takes to
answer.

## Decision

We will record the intent to dispatch in the **same transaction** as the charge, in an `sms_outbox`
table, and hand the message to the broker **outside** that transaction.

One transaction contains: the guarded debit, the sender's traffic count, the `PENDING`
`sms_message` row, and the `sms_outbox` row. It commits or none of it happened. **That commit is what
makes it impossible to take money without recording what it was taken for**, and it is also why a
rejected send cannot leave itself counted against its sender.

After the commit, `SmsDispatcher.dispatch` attempts the broker in-request, best effort. On success
the outbox row is deleted and the message marked `QUEUED`. On failure the row is rescheduled with
backoff — **and the request still returns 201**.

**`201` means accepted, not delivered.** A broker that refuses does not fail the request, because the
send is paid for, recorded, and owed; the outbox row is the system's standing commitment to deliver
it. `SmsDispatcher.dispatch` never throws, for exactly that reason.

`SmsOutboxRelay` polls every 2 seconds in the API process and claims two kinds of row: one rescheduled
after a failed attempt, and one whose claim went stale after 60 seconds because whoever held it died
mid-dispatch. **The claim is one statement**, using `FOR UPDATE SKIP LOCKED`, which is what lets
every application instance poll at once without a row ever being handed to two of them. It is raw
SQL because Prisma has no `FOR UPDATE`, and deliberately not routed through the ambient transaction:
claiming is the relay's own unit of work and must commit immediately.

Three details that look arbitrary and are not:

- **`enqueue` writes `IN_FLIGHT`, not `PENDING`**, because the request is about to attempt it. A row
  left claimable in that window would be raced by the relay, and the carrier would see the message
  twice.
- **A settled row is deleted**, because `sms_message` is already the audit record and the poller's
  index stays small.
- **`payload` is self-contained** rather than a join back to `sms_message`, so a consumer needs no
  second read.

Backoff is 2s, 4, 8, 16; on the fifth attempt the row is dead-lettered and the message marked
`FAILED`, in one transaction.

The business justification is that the alternative loses money silently. A dual write's failures are
invisible — no error, no log line, just a customer who paid for a message that never went out. The
outbox turns that into a row that can be found, retried, and reported on.

## Consequences

**Delivery is at-least-once, not exactly-once.** A publish that succeeds and a settle that fails
leaves the row to be attempted again. That is why `SmsProvider.deliver` takes the message id: it is
an idempotency key for a real carrier to de-duplicate on. `LoggingSmsProvider` ignores it, having
nothing to de-duplicate against.

**No automatic refund on a dead letter, deliberately.** Reimbursing from the same code path that has
just failed five times is how a bug becomes money, and a dead letter is a decision for a person.
`OutboxSmsDispatcher` has no ledger among its dependencies at all — it *cannot* refund. An operator
makes the sender whole through the existing `POST /api/credit/increase`. This is a consequence of
putting dispatch behind the outbox rather than an independent decision, and it means an outage's cost
is measured in refunds a person has to issue (ADR 17).

There is a window, bounded by the poll interval, in which a message is paid for and not yet
published. That window is the price of not holding a transaction across the network, and it is the
right trade.

The relay is in the API process, so an API instance is doing background work. `OUTBOX_RELAY_ENABLED`
turns it off, which the acceptance test stack sets — a poller sweeping a database the suite truncates
between scenarios is a flake source with nothing to catch there.

**The premise this ADR was written on did not survive the week.** The outbox was designed when a
successful publish meant the message had been delivered, so publishing could honestly mark it `SENT`.
Kafka's arrival (ADR 10) made that false, and ADR 12 replaces that half of this decision. The
outbox itself, the claim query, the retry policy and the transaction are untouched by that change —
which is the seam working as intended.

## Compliance

`backend/src/modules/sms/infrastructure/outbox/outbox-sms-dispatcher.spec.ts` covers the dispatcher,
including the retry, backoff and dead-letter paths — which is the only place they *are* covered,
since the stand-in carrier never fails (ADR 17).

`make lint-architecture` enforces the structural half: the `domain` layer may not import `kafkajs`,
Prisma or NestJS, so the broker cannot creep back into the handler by accident. That rule is what
makes "do not move the dispatch into the handler" a constraint rather than a comment.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-31 · Last modified: 2026-07-31

Related: ADR 8 (the transaction is the second instance of the guarded-write rule), ADR 12
(supersedes the publish-means-sent premise), ADR 17 (the deferred circuit breaker).
