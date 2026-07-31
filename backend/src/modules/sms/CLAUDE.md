# SMS Module (`src/modules/sms/`)

Follow `../identity/CLAUDE.md` for the module *shape*. This file covers the one thing that is not
shape: how a send survives money, concurrency and a carrier that says no.

---

## The life of a send

```
POST /api/sms
  │
  ├─ one transaction ──────────────────────────────────────────┐
  │   CreditLedger.charge          (guarded debit — 402 if short)│
  │   SenderTraffic.recordSend     (guarded counter → tier)      │
  │   SmsMessage.queue → save      (status PENDING)              │
  │   SmsOutbox.enqueue(lane)      (status IN_FLIGHT, attempts 1)│
  └──────────────────────────────────────────────────────────────┘
  │ commit
  ├─ SmsDispatcher.dispatch    (in-request, best effort, never throws)
  │     ok   → outbox row deleted, message QUEUED
  │     fail → row rescheduled with backoff; 201 is still returned
  │
  └─ 201 { id, cost, guaranteedDeliveryAt? }

               Kafka: sms.dispatch.{express,bulk,shared}, key = senderId
                                    │
worker process, one per lane:       ▼
    SmsProvider.deliver → message SENT, or FAILED once the budget is spent

SmsOutboxRelay, every 2s, in the API process:
    claim due + abandoned rows (FOR UPDATE SKIP LOCKED) → SmsDispatcher.dispatch
```

**The transaction is the point.** Charging, counting, recording and enqueueing commit together, so
there is no window in which money is taken for a message nobody recorded — the failure the previous
charge → deliver → save arrangement documented as accepted. The broker is deliberately *outside*
it: a transaction held open across someone else's network keeps a wallet row locked for as long as
their network takes.

**`201` means accepted, not delivered** — and now means it twice over. A broker that refuses does
not fail the request, because the send is paid for, recorded, and owed; the outbox row is the
system's commitment to deliver it. `SmsDispatcher.dispatch` never throws for exactly this reason.

## The three lanes

A lane is a **bulkhead**: its own topic, its own consumer group, its own worker process. That is the
whole mechanism behind two promises this system would otherwise only be able to hope for — that an
express message is not stuck behind a marketing blast, and that a whale's Friday campaign does not
delay a corner shop's single confirmation SMS.

| service level | traffic tier | lane      | topic                  | partitions |
| ------------- | ------------ | --------- | ---------------------- | ---------- |
| EXPRESS       | *(any)*      | `EXPRESS` | `sms.dispatch.express` | 6          |
| STANDARD      | `BULK`       | `BULK`    | `sms.dispatch.bulk`    | 6          |
| STANDARD      | `SHARED`     | `SHARED`  | `sms.dispatch.shared`  | 12         |

`DispatchLane.for(serviceLevel, tier)` is the entire routing rule, in the domain and testable with
no broker in sight. **Service level wins over traffic tier**: a promise made to a large customer is
worth what the same promise made to a small one is worth.

**The key is `senderId`, and keying alone is not enough.** Kafka orders within a partition and
assigns partitions by hashing the key, so keying on the sender gives each customer a stable
partition and a stable order. But a key cannot stop one enormous sender from filling the partition
it lands on, along with everyone else hashed there — moving that sender to a different *topic* is
what stops it. Tiering and keying solve different halves of the same problem.

`shared` has the most partitions despite carrying the least per customer, and that is deliberate: it
holds the long tail, so its partition count decides how many senders end up behind the same
head-of-line block. `bulk` holds few keys, each enormous, and more partitions would not spread one
sender any thinner.

**The lane is decided once, at enqueue, and stored in `sms_outbox.type`** — which is exactly what
that column's schema comment always promised it was for. A retry therefore travels the lane the
message was classified into when it was accepted, rather than wherever its sender's rate has drifted
to since.

## How a sender gets a tier

`sms_sender_traffic` counts sends in a rolling window, one row per sender, and
`TrafficTier.forSendCount` classifies the count against a `TrafficPolicy` read from
`SMS_BULK_TIER_THRESHOLD` / `SMS_TRAFFIC_WINDOW_IN_SECONDS`.

**The tier is never stored**, for the reason `guaranteedDeliveryAt` is never stored: it is derived
from a threshold that is configuration, so changing the threshold reclassifies everyone at once
instead of leaving a table of stale verdicts behind.

**The counter is one statement** — an `INSERT … ON CONFLICT DO UPDATE` whose two `CASE` expressions
also roll an expired window over. This is the third instance of the rule in *Concurrency, and the
two rules that keep money honest*: a read-modify-write would lose increments under exactly the load
that matters, and a whale that undercounts itself stays in the shared lane and swamps it. Rolling
the window over inside the same statement is why there is no sweeper and no cron.

`GET /api/sms/traffic` publishes the classification, the count, the window and the threshold — the
last so a customer can see a reclassification coming. It publishes **no lane, no topic and no
worker**: separate capacity is the promise, and the mechanism is ours to change.

## Message states

`SmsStatus` — `PENDING` → `QUEUED` → `SENT`, or → `FAILED` once we stop trying.

**`QUEUED` is the state the broker made necessary.** Before there was one, publishing *was*
delivering, so a successful publish could honestly be recorded as `SENT`. A publish now means an
acknowledgement from Kafka and nothing more; the worker consuming the lane is what marks a message
`SENT`. Collapsing the two back together would report messages as delivered while they sit on a
partition.

**The transitions are forward-only, and enforced twice.** `QUEUED` is written by the API once Kafka
acknowledges the publish; `SENT` is written by a worker on the far side of the broker. Those are two
processes racing on one row, and the worker frequently wins — so `SmsStatus.canFollow` refuses a
backwards move in the aggregate, and `PrismaSmsMessageRepository` states the same rule again as a
`WHERE status IN (…)` guard on every write. Neither alone is enough: the aggregate reasons about the
row it read, and a row it read a moment ago is exactly what a racing writer invalidates.

Skipping the SQL half is not theoretical. Before it existed, forty concurrent sends left **39 of 45
messages stuck at `QUEUED`** with the consumer group fully caught up: every one had been delivered
and marked `SENT`, and every one had that overwritten by the API's `markQueued` a moment later. The
report filters on `SENT`, nothing revisits a settled message, and the outbox row was already gone —
so a delivered SMS was reported as undelivered permanently. This is the fourth instance of the rule
in `../../../CLAUDE.md`'s *Concurrency* section, and it arrived the same way the first three did.

`PrismaSentSmsReportRepository` filters `status: 'SENT'`. Drop that predicate and the report starts
announcing messages still in the outbox, ones sitting on a partition, and ones dead-lettered after
the carrier refused them for good.

`sentAt` is when the send was **accepted**, not when the carrier took it — which is what the express
guarantee is measured from, so the promise does not slide when a carrier is slow.

## The outbox table

`sms_outbox`: `PENDING` (due, unclaimed) → `IN_FLIGHT` (someone is attempting it) → deleted, or →
`DEAD`. A settled row is **deleted**, because `sms_message` is already the audit record and the
poller's index stays small.

`payload` is self-contained rather than a join back to `sms_message`, and `type`
(`sms.dispatch.requested`) names what it is. Both are for the same reason — see the Kafka note below.

**The claim is one statement**, in `PrismaSmsOutboxRepository.claimAbandoned`, using
`FOR UPDATE SKIP LOCKED`. That is what lets every app instance poll at once without a row ever being
handed to two of them. It claims two kinds of row: one rescheduled after a failed attempt, and one
whose claim went stale (60s) because whoever held it died mid-dispatch — the crash recovery the
whole design exists for. Raw SQL, because Prisma has no `FOR UPDATE`, and deliberately *not* through
`client()`: claiming is the relay's own unit of work and must commit immediately.

`enqueue` writes `IN_FLIGHT`, not `PENDING`, because the request is about to attempt it. A row left
claimable in that window would be raced by the relay and the carrier would see the message twice.

## Retry, and giving up

Backoff 2s, 4, 8, 16; on the fifth attempt the row is dead-lettered and the message marked `FAILED`,
in one transaction.

**No automatic refund**, deliberately. Reimbursing from the same code path that has just failed five
times is how a bug becomes money, and a dead letter is a decision for a person. `OutboxSmsDispatcher`
has no ledger among its dependencies at all — it *cannot* refund. An operator makes the sender whole
through the existing `POST /api/credit/increase`.

**Delivery is at-least-once.** A publish that succeeds and a settle that fails leaves the row to be
attempted again. That is why `SmsProvider.deliver` takes the message id: it is an idempotency key
for a real carrier to de-duplicate on. `LoggingSmsProvider` ignores it, having nothing to
de-duplicate against — and never throws, so the retry, backoff and dead-letter paths are unreachable
through it and live only in the tests.

`OUTBOX_RELAY_ENABLED=false` turns the poller off; the acceptance test stack sets it (see
`../../CLAUDE.md`).

## The workers

`src/worker.ts` boots a `WorkerModule` through `createApplicationContext` — no HTTP server, no
controllers, no relay, no credit ledger. `WORKER_LANE` names the one lane the process consumes, and
it **throws on a missing or unrecognised value** rather than defaulting: a worker that silently
picked `SHARED` because of a typo would look healthy while its real lane went unconsumed, which is
the exact outage the lanes exist to prevent.

**One process, one lane.** A single process consuming all three would put express messages and a
bulk backlog on the same event loop and the same connection pool — the arrangement the lanes exist
to prevent. Scaling a lane is more replicas of that lane's container.

**`KafkaTopicProvisioner` runs on `onModuleInit`, and that is not a stylistic choice.** Nest runs
every `onApplicationBootstrap` in a module *concurrently* (`await Promise.all(...)` in
`@nestjs/core/hooks/on-app-bootstrap.hook.js`), so listing the provisioner before
`SmsDispatchConsumer` in `providers` orders nothing at all. When both used that hook,
`consumer.subscribe()` won, asked for metadata on a topic that did not exist yet, and — with
`KAFKA_AUTO_CREATE_TOPICS_ENABLE=false` — was answered `UNKNOWN_TOPIC_OR_PARTITION`. That killed the
worker *and* the half-finished provisioner with it, so no topics were ever created, all three lanes
stayed dead on every fresh broker, and the acceptance suite's reporting scenarios timed out waiting
for a delivery nobody was going to make. Nest awaits all `onModuleInit` hooks before any
`onApplicationBootstrap`; that is the only ordering guarantee available here.

**And it fails the boot rather than warning.** The old leniency was written for an API, which must
start without a broker because it has an outbox to accept sends into. This class is worker-only —
`sms.module.ts` says so explicitly — and a worker without its topic can do nothing at all. Failing
loudly, plus `restart: unless-stopped` on the three worker services, is what makes a cold start
self-heal instead of leaving a lane silently unconsumed. Note what does *not* help here:
`docker compose up --wait` reports a worker healthy the moment it is running, because the workers
carry no healthcheck.

**The retry budget is per lane, because a consumer retrying in place blocks its partition.** Express
retries three times with a 200ms base; standard lanes retry five times with a 1s base. That makes it
a latency decision, not a reliability one: a message that spends four of its five promised minutes
backing off has already broken the promise. A dead-letter topic per lane is the next step if carrier
outages ever outlast these budgets — deliberately not built, since it triples the topic count to
solve something the stand-in carrier cannot yet demonstrate.

`SmsDispatchConsumer.handle` **never throws**. An exception out of `eachMessage` makes kafkajs retry
the same offset indefinitely, so one permanently bad message would stop the lane for everything
behind it. A message id that no longer exists is tolerated and committed, for two reasons that both
really happen: delivery is at-least-once, so a redelivery can arrive after the row was cleaned up,
and the acceptance suite truncates between scenarios.

**The express promise is measured, not just made.** `warnIfLate` recomputes the deadline from the
dispatch's `sentAt` and its service level and logs a warning when delivery lands past it. It fails
nothing — the message went out and was charged for either way, and a deadline that has passed cannot
be un-passed — but a guarantee nobody measures is a guarantee nobody knows they are breaking, and
that line is the first thing that would show the express lane needing more replicas. `sentAt` rides
on the Kafka payload precisely so this arithmetic needs no database read, and the deadline is
recomputed rather than carried for the reason nothing persists it: `ServiceLevel` owns the window,
and a second copy would be free to disagree.

## Where the broker plugs in — and why it stays out of the handler

`SmsDispatchPublisher` was written as a seam and `KafkaSmsDispatchPublisher` is what arrived through
it. Everything the seam promised would survive did: the outbox table, the claim query, the retry
policy, the transaction and the whole domain are untouched by the swap.
`ProviderSmsDispatchPublisher` stays on disk as the broker-free implementation, which is why
`SmsProvider` is still bound in the API process even though only the workers call a carrier now.

**Do not move the dispatch into the handler.** Producing to a broker from a command handler is a
dual write across Postgres and the broker with no transaction spanning them — the charge commits and
the produce fails, or the reverse. The outbox is what makes the broker correct, not an alternative
to it.
