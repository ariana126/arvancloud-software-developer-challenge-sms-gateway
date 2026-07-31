# 16. Serve the Sent-SMS Report From the Write Database, For Now

## Status

Accepted — deferred implementation — 2026-07-31.

## Context

`GET /api/sms/report` returns a sender's delivered messages.
`PrismaSentSmsReportRepository.findBySender` serves it with one `findMany` straight at
`sms_message`, on the primary database.

That is the same table three worker processes and the API write to concurrently, under the
guarded-delta regime of ADR 8 and the forward-only status transitions of ADR 12. The two workloads
have genuinely different shapes:

| | Writes | Report reads |
| --- | --- | --- |
| Rows touched | One, by primary key | A range, one sender's history |
| Latency | Critical — on the paid send path | Tolerable — a page load |
| Staleness | Must be current | Seconds-old is fine |
| Indexes wanted | Primary key | `senderId`, `sentAt` |
| Contention | With each other | With every write on the table |

`@@index([senderId])` is the only thing keeping the report off a sequential scan as the table grows,
and the table grows once per SMS sent — which is the one thing this product is designed to do a lot
of.

The alternatives:

- **(a) A read replica**, with the report repository pointed at it. Cheapest by far: a connection
  string and a Compose service. The cost is replica lag — a message a worker marked `SENT` a moment
  ago may be absent from the next report read. The acceptance suite's reporting scenarios would see
  that as a flake, and a customer would see it as a message that vanished and came back.
- **(b) A denormalised read model**, maintained by a projector subscribing to the domain events the
  repositories already publish through the EventBus. No lag to reason about at read time, and it adds
  a projection to keep correct, a rebuild path to own, and a new class of bug where the projection
  and the source disagree.
- **(c) A separate read store entirely** — the full CQRS split, with its own database. Far more than
  the problem justifies at any load this system will plausibly see soon.
- **(d) Keep one database, and decide later.**

## Decision

We will continue to serve the sent-SMS report from the primary database, and will not separate the
read load yet.

**The decisive fact is that the seam is already built.** The read side is already a separate port,
not a repurposed write repository:

- `SentSmsReportRepository` is declared in `application/queries/`, beside the query handler that uses
  it — not alongside the write-side `SmsMessageRepository` in `domain/service/`.
- `PrismaEntityRepository` is deliberately **not** its base class, and the implementation says why:
  that base exists to load, save and publish events for a write model, and a report needs none of the
  three. Reconstituting every row into an `SmsMessage` aggregate only to read six fields back off it
  would cost a crop of getters for no reader's benefit.
- Every part of the contract is pushed into the query rather than applied after it — the `SENT`
  filter, the `senderId` predicate, the `sentAt` ordering.

So adopting (a) or (b) later is a change to **one adapter class**, with no handler, no port, no
controller and no domain touched. Deferring is cheap **because the reversal cost has already been
paid** — which is precisely what makes this the last responsible moment rather than an avoided
decision. The cost of deciding later has been engineered down to nearly nothing; the risk of deciding
now is choosing between (a) and (b) with no production traffic to distinguish them.

The business justification is the deadline this system was built against, and it is worth stating
plainly rather than dressing up: this is a hiring-task submission, the load that makes separation pay
does not exist, and building it now would spend the remaining time on infrastructure a reviewer
cannot see instead of on behaviour they can. Choosing between a replica and a projection also
requires knowing the read/write ratio and the staleness a customer will accept, and neither is
knowable before real traffic.

**Revisit when:** report p99 latency becomes user-visible, **or** lock contention appears on
`sms_message` — whichever comes first. Take (a) if the read/write ratio is the problem and seconds of
staleness are acceptable; take (b) if staleness is not acceptable or the report grows aggregations
that a replica would still compute per request.

## Consequences

A long report for a heavy sender competes for the same rows and the same instance as the guarded
status writes that ADR 12 exists to protect. Under enough load this is a source of exactly the
contention that decision is about — the report does not corrupt anything, but it can slow the path
that money is on.

The report is only as available as the write database. There is no degraded mode where sends stop
but reporting continues, or the reverse.

Scaling reads and writes independently is not possible: the only lever is a bigger primary.

**This deferral is repo-wide, not report-specific.** The `identity` module's query handler carries a
`// TODO` recording that it is not yet a true read side either — it goes through the write repository
and calls `toPrimitives()` to build its read model. The same decision covers it, and the same seam
makes it cheap to change.

Because the report is served from the primary, it is strongly consistent — a message marked `SENT`
appears immediately. The acceptance suite's reporting scenarios depend on that today, and adopting
(a) later would require them to tolerate lag. **That is the hidden migration cost**, and it is worth
naming now: the cheap option is cheap in the backend and not free in the test suite.

## Compliance

Nothing enforces this decision, because there is nothing to enforce — it is the absence of work.

What governs it is what would tell us the moment has arrived:

- **Report p99 latency**, once there is any observability to measure it with. There is none today;
  the system logs structurally through pino but has no metrics pipeline.
- **Lock contention on `sms_message`** — `pg_stat_activity` and `pg_locks` in the primary.

The structural precondition is checkable now, and should be re-checked before anyone assumes the
deferral is still cheap: `SentSmsReportRepository` must remain a port that no write-side code
implements, and `PrismaSentSmsReportRepository` must remain free of `PrismaEntityRepository`. If a
later change routes the report through the write repository, this decision stops being reversible for
one class and starts being a refactor.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-31 · Last modified: 2026-07-31

A decision to defer, not an oversight. Recorded so that the gap is dated and the trigger is explicit.

Related: ADR 5 (CQRS is what gave the read side its own port), ADR 8 and ADR 12 (the writes this read
contends with).
