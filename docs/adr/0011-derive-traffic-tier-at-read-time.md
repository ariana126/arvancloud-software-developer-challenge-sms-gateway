# 11. Derive the Traffic Tier at Read Time Rather Than Storing It

## Status

Accepted — 2026-07-31 (`e564c9e`).

## Context

ADR 10 routes standard traffic into a `BULK` or `SHARED` lane depending on whether a sender is a
high-volume customer. Something has to decide which, and "high volume" is a threshold — a number of
sends within a rolling window, configured by `SMS_BULK_TIER_THRESHOLD` and
`SMS_TRAFFIC_WINDOW_IN_SECONDS`.

The natural implementation is a `tier` column on the sender: classify, store, read it back when
routing. The alternatives were:

- **Store the tier**, updated whenever the count crosses the threshold. Cheap to read, and it needs a
  writer — either a job that sweeps senders, or a check on every send that conditionally writes.
- **Store the tier, recomputed by a scheduled job.** A sender's tier is then stale by up to one job
  interval, and there is a cron to own.
- **Store only the count, and derive the tier when it is needed.**

The question that settles it: **what happens when the threshold changes?** A stored tier is a verdict
computed against a threshold that is configuration. Change the configuration and every stored verdict
is now a lie, with no error anywhere — until someone remembers to backfill.

## Decision

We will store the send count and **derive the tier at read time**, never persisting it.

`sms_sender_traffic` holds one row per sender: a count and a window. `TrafficTier.forSendCount`
classifies that count against a `TrafficPolicy` built from configuration. **Changing the threshold
reclassifies everyone at once**, because there is no table of stale verdicts to leave behind.

This is the same reasoning that keeps `guaranteedDeliveryAt` unstored: it is derived from
`ServiceLevel`'s window, and a persisted copy would be free to disagree with the rule that produced
it.

**The counter is one statement.** `PrismaSenderTrafficRepository.recordSend` is an
`INSERT … ON CONFLICT DO UPDATE` whose two `CASE` expressions increment the counter *and* roll an
expired window over, atomically. This is the third instance of ADR 8's rule, and it matters for a
reason specific to this feature: a read-modify-write would lose increments under exactly the load
that makes tiering necessary, and **a heavy sender that undercounts itself stays in the shared lane
and swamps the customers it was supposed to be separated from**. Rolling the window over inside the
same statement is why there is no sweeper and no cron.

`GET /api/sms/traffic` publishes the classification, the count, the window and the threshold. The
threshold is there so a customer can see a reclassification coming. It publishes **no lane, no topic
and no worker** — separate capacity is the promise; the mechanism is ours to change (ADR 10).

The business justification is operability. The threshold is the one number an operator will want to
tune once the system meets real traffic, and this decision makes tuning it a configuration change
that takes effect immediately, rather than a configuration change plus a migration plus a backfill
plus an incident when someone forgets the backfill.

## Consequences

Every routing decision costs a read and a classification rather than a column lookup. At this scale
that is nothing; at a much larger one it would be a cache, not a stored column.

A sender's tier can change between two sends, which is the intended behaviour and does mean a
customer can move lanes mid-campaign. ADR 10's decision to fix the lane at enqueue is what keeps that
from affecting a message already accepted.

The window is rolling and per-sender, advanced only when that sender sends. A sender that goes quiet
keeps its last window until its next send rolls it over. There is no background process to notice
this, and none is wanted — a sender that is not sending is not competing for capacity.

Configuration reaches the domain through a boundary that needs care. `ConfigService.get<number>` is a
cast, not a conversion: it hands back `'3'` where the type says `3`. `traffic-policy.provider.ts`
converts explicitly, because `TrafficPolicy.of` validates that its arguments are integers and would
otherwise fail at boot.

The two `SMS_*` variables have code defaults (1000 and 60), so an older `.env` still boots. The test
stack sets the threshold to **3** so the acceptance suite can cross it in a handful of requests —
which is only possible *because* the tier is derived. A stored tier would have needed the suite to
manufacture a thousand sends or to write to the database directly, and the latter is a door ADR 14
does not permit.

## Compliance

- `sms/domain/value/traffic-tier.spec.ts` — the classification rule against a policy.
- `acceptance-tests/specs/sms-sending/high-volume-senders.feature` — three scenarios, black-box: a
  light sender shares capacity, a heavy sender is given its own, and **one customer's volume does not
  reclassify another**. The third is the one that would catch a shared-counter defect.

The structural guarantee is stronger than any test: `grep -rn "tier" backend/prisma/schema/` finds no
column. There is nothing to fall out of date, so there is nothing to check.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-31 · Last modified: 2026-07-31

Related: ADR 8 (the counter is its third instance), ADR 10 (what the tier is for).
