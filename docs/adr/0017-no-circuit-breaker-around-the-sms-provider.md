# 17. No Circuit Breaker Around the SMS Provider, For Now

## Status

Accepted — deferred implementation — 2026-07-31.

## Context

`SmsProvider.deliver` is the port for handing a message to whatever actually carries it. The only
adapter today is `LoggingSmsProvider`, a stand-in that writes a log line and **never throws**. That
is why `sms/CLAUDE.md` records that the retry, backoff and dead-letter paths are unreachable through
it and live only in the tests.

A real carrier reached over HTTP behaves differently in a way that matters. It can refuse a message
— a bad number, a rejected sender id — which is a per-message failure. It can also be **slow or
down**, which is not a per-message failure at all: it is a property of the dependency, and every
message discovers it separately.

**What already covers part of this.** The system is not naive about carrier failure:

- Per-lane retry budgets — express retries 3 times with a 200 ms base, standard lanes 5 times with a
  1 s base (ADR 10).
- Dead-lettering on the fifth attempt, with the message marked `FAILED` in one transaction (ADR 9).
- `SmsDispatchConsumer.handle` never throws, so one permanently bad message cannot make kafkajs retry
  an offset forever and wedge the lane behind it.
- The three lanes are bulkheads, so one lane's trouble is not another's (ADR 10).
- `warnIfLate` recomputes the express deadline from `sentAt` and logs when a delivery lands past it.

**What none of that covers.** Those budgets are sized for a carrier that *refuses a message*, not one
that is *down*. A consumer retrying in place blocks its partition. With the carrier unreachable,
every message on that partition burns its full budget in sequence before dead-lettering — so a
carrier outage converts directly into head-of-line blocking for the entire lane, and the lane's
throughput collapses to one message per retry budget.

Express is where it bites hardest. A message that spends four of its five promised minutes backing
off has already broken the guarantee, and `warnIfLate` will faithfully log it having done so. The
bulkheads contain the damage to one lane; they do nothing about the damage *within* it.

A circuit breaker is the standard answer: once a dependency is known bad, stop calling it, fail fast,
and probe occasionally to see whether it has recovered.

## Decision

We will not add a circuit breaker around `SmsProvider` while the only adapter is a stand-in that
cannot fail.

The justification is not only the deadline. **A resilience mechanism tuned against a fake that never
fails is tuned against nothing.** Every meaningful parameter of a breaker — the failure count or rate
that trips it, how long it stays open, how many probes half-open allows, and crucially *which
failures count* — is calibration against a real carrier's failure signature. Timeouts and connection
refusals should trip a breaker; a 400 for a malformed number must not, or one bad message opens the
circuit for everyone. None of those distinctions can be made against `LoggingSmsProvider`, because it
produces no failures to classify. Guessing them now would produce a breaker that must be re-tuned on
the day a real carrier arrives — so the work would be done twice, and the first version would carry
false confidence in between.

**Where it would go, in one sentence, because that is what makes the deferral defensible:** a
decorator implementing `SmsProvider` and wrapping the real adapter, bound in place of it in
`sms/infrastructure/`. The port exists and is already narrow — it takes the values it needs rather
than the aggregate — so nothing in the domain, the outbox, the relay, the consumer or the handler
changes. This is the same seam that absorbed the entire arrival of Kafka without touching the domain
(ADR 9).

**This is a stated policy, not a one-off.** `sms/CLAUDE.md` already defers a per-lane dead-letter
topic with the same reasoning — "deliberately not built, since it triples the topic count to solve
something the stand-in carrier cannot yet demonstrate". That companion piece of work belongs to the
same trigger as this one: both are carrier-failure infrastructure, and both should be designed
together against a real carrier's behaviour rather than separately against a guess.

The business justification is time to market. With a stand-in carrier, a breaker protects against
nothing that can happen, and the same hours spent on send correctness, the express guarantee and the
report are hours a reviewer or a customer can observe.

**Revisit when:** `LoggingSmsProvider` is replaced by an adapter that performs network I/O. That is a
hard trigger, not a judgement call, and it should be a precondition of that replacement's pull
request — the breaker and the real adapter land together, or the lane is exposed the moment the
adapter is.

## Consequences

Until then, a carrier outage degrades to lane-wide latency and eventual dead-lettering, rather than
fast failure. The lane recovers on its own once the carrier does, but everything queued behind the
outage has already spent its budget.

**Each of those dead letters is manual operator work.** ADR 9 decided there is no automatic refund —
`OutboxSmsDispatcher` has no ledger among its dependencies and *cannot* refund one. So an outage's
cost is measured in refunds a person has to issue through `POST /api/credit/increase`, one per
message. That is the concrete business exposure of this deferral, and it scales linearly with outage
length.

The express guarantee is not protected against carrier failure, only against internal queueing. That
is a real limit on what the guarantee currently means, and `warnIfLate` will measure the breach
rather than prevent it — which is why that log line exists at all. **A guarantee nobody measures is a
guarantee nobody knows they are breaking**, and it is the first signal that would show this deferral
coming due.

Deferring costs nothing structurally, because the seam is already in place. It costs something in
operational readiness: on the day a real carrier is integrated, the system has no protection until
the breaker is written, and the pressure at that moment will be to ship the adapter first.

## Compliance

Nothing enforces this decision, because it is the absence of work.

What governs it is what would tell us the moment has arrived:

- **`warnIfLate` warning volume** — a rise in express deliveries landing past their deadline is the
  first observable signal that carrier latency is eating the guarantee. It exists and logs today.
- **Dead-letter rate** — `sms_outbox` rows reaching `DEAD`, and `sms_message` rows reaching `FAILED`.
  Both are queryable now.
- **The hard trigger**: any change binding a `SmsProvider` implementation that performs network I/O.
  `grep -rn "SmsProvider" backend/src/modules/sms/infrastructure/` names the adapters; today it finds
  `LoggingSmsProvider` and nothing else.

The structural precondition that keeps this cheap to reverse is checkable now: `SmsProvider` must
remain a narrow port taking values rather than the aggregate, so a decorator can wrap it without
knowing anything about `SmsMessage`.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-31 · Last modified: 2026-07-31

A decision to defer, not an oversight. Recorded so that the gap is dated and the trigger is explicit.

Related: ADR 9 (retry, dead-lettering, and the no-automatic-refund consequence this inherits), ADR 10
(the per-lane retry budgets and the dead-letter topic deferred alongside this).
