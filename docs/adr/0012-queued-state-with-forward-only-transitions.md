# 12. A `QUEUED` State, With Forward-Only Transitions Enforced Twice

## Status

Accepted — 2026-07-31 (`d7942e0`). Supersedes 9 in part.

## Context

ADR 9 built the outbox when publishing and delivering were the same act: `SmsDispatcher` handed the
message to a provider, and a successful hand-off could honestly be recorded as `SENT`.

ADR 10 made that false. A publish now means an acknowledgement from Kafka and nothing more; the
worker consuming the lane is what actually reaches a carrier. Collapsing the two back together would
report messages as delivered while they sit on a partition.

So a state between "accepted" and "delivered" was needed. And introducing it created a second
problem, which is the real subject of this record: **`sms_message` now has two writers in different
processes.** The API marks a message `QUEUED` once Kafka acknowledges the publish. A worker, on the
far side of that broker, marks it `SENT`. They race on one row, and **the worker frequently wins** —
a broker acknowledgement and a carrier delivery are close enough in time that the ordering is
genuinely unpredictable.

`PrismaSmsMessageRepository` inherited `PrismaEntityRepository`'s unconditional whole-state upsert.
That had been correct, and was documented as correct, back when a message had exactly one writer.

**What it cost, measured:** forty concurrent sends left **39 of 45 messages stuck at `QUEUED`** with
the consumer group fully caught up. Every one had been delivered and marked `SENT` by a worker, and
every one had that overwritten by the API's `markQueued` a moment later. The report filters on
`SENT`, nothing revisits a settled message, and the outbox row was already deleted — so a delivered
SMS was reported as undelivered, permanently, with no error anywhere.

## Decision

We will model the message lifecycle as `PENDING → QUEUED → SENT`, or `→ FAILED` once we stop trying,
and we will enforce those transitions as **forward-only in two places at once**.

`SmsStatus.canFollow` refuses a backwards move in the aggregate. `PrismaSmsMessageRepository` states
the same rule again as a `WHERE status IN (…)` guard on every write, where a zero-row result means
somebody else got further first.

**Neither alone is enough, and this is the whole point.** The aggregate reasons about the row it read,
and a row it read a moment ago is exactly what a racing writer invalidates. The SQL guard is the only
place a concurrent writer can be seen. The domain rule is the only place the intent is legible and
testable. Removing either one restores the defect — the SQL half silently, which is worse.

This is the fourth instance of ADR 8's rule, and it arrived the same way the first three did: a
whole-state write where a guarded delta was needed.

Two supporting decisions belong to the same shape:

- **`PrismaSentSmsReportRepository` filters on `status: 'SENT'`.** Drop that predicate and the report
  announces messages still in the outbox, ones sitting on a partition, and ones dead-lettered after
  the carrier refused them for good.
- **`sentAt` is when the send was *accepted*, not when the carrier took it** — which is what the
  express guarantee is measured from, so the promise does not slide when a carrier is slow.

The business justification is that the failure was a **correctness failure visible to the customer**:
they paid, the message arrived, and the system told them it had not. That is worse than an outage,
because it is silent and it undermines the report — which is one of the four things this product
does.

## Consequences

The transition rule is stated twice and the two statements can drift. That duplication is deliberate
and load-bearing, so it must not be "simplified"; the incident above is what simplifying it looks
like.

`markQueued` is now a write that can legitimately do nothing. A caller must not treat a zero-row
result as an error — it is the normal outcome of losing a race that was never a problem.

The status enum is part of the API contract. `QUEUED` is visible to clients, and it means "accepted
and published, not yet delivered" — a distinction customers can now see and will ask about.

The premise that broke here is the one worth carrying forward: **"this aggregate has one writer" is a
fact about the system, not about the code, and it can stop being true without the code changing.**
The comment above the class was accurate when written and wrong when it mattered. Adding a writer is
the moment to re-read ADR 8.

## Compliance

**Partial, and the gap is named deliberately.**

Covered: `sms/domain/sms-message.aggregate.spec.ts` covers the domain half thoroughly — that
`markQueued` after the carrier took it leaves the message `SENT`, that `markQueued` after a failure
leaves it `FAILED`, that a sent message cannot be walked back, and that re-marking a sent message
records no second event.

**Not covered: the SQL half has no automated gate at all.** There is no
`sms-message.repository.spec.ts`, and no acceptance scenario reproduces the race — the suite's
concurrency scenario ("Two sends at the same moment cannot both spend the same credit") exercises
ADR 8's wallet guard, not this one. The incident was found by hand, under load the suite does not
generate.

So the exact half whose absence caused a customer-visible defect is the half nothing would catch if
it were removed again. Writing this section is what surfaced that. The fix is a repository-level
test that writes `SENT` and then attempts `QUEUED` against a real Postgres, and it is owed.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-31 · Last modified: 2026-07-31

Supersedes ADR 9's premise that a successful publish means a message was sent. The outbox, claim
query, retry policy and transaction from ADR 9 are unaffected.
