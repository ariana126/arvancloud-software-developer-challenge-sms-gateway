# 10. Three Isolated Kafka Dispatch Lanes, One Worker Process Each

## Status

Accepted — 2026-07-31 (`e564c9e`).

## Context

The system makes two promises it could not previously keep. An **express** message carries a
five-minute delivery guarantee. And a small customer's single confirmation SMS should not sit behind
a large customer's marketing blast.

Both are the same problem: one workload delaying another. With a single dispatch path there is no
mechanism behind either promise — only the hope that the queue is short when it matters.

The alternatives:

- **One topic, no keying.** Messages interleave arbitrarily; a large sender's backlog is everyone's
  backlog.
- **One topic, keyed by `senderId`.** Kafka orders within a partition and assigns partitions by
  hashing the key, so each customer gets a stable partition and a stable order. **This is necessary
  and not sufficient.** A key cannot stop one enormous sender from filling the partition it lands on
  — along with every other sender hashed there. Keying decides *ordering*; it does nothing about
  *capacity*.
- **Priority within one topic.** Kafka has no priority consumption. Emulating it means a consumer
  that reads ahead and reorders, which gives up ordering and gains a scheduler to maintain.
- **Separate topics per class of traffic, consumed by separate processes.**

## Decision

We will route dispatch into three lanes — `EXPRESS`, `BULK`, `SHARED` — each with **its own topic, its
own consumer group, and its own worker process**, and key each message by `senderId`.

| Service level | Traffic tier | Lane | Topic | Partitions |
| --- | --- | --- | --- | --- |
| EXPRESS | *(any)* | `EXPRESS` | `sms.dispatch.express` | 6 |
| STANDARD | `BULK` | `BULK` | `sms.dispatch.bulk` | 6 |
| STANDARD | `SHARED` | `SHARED` | `sms.dispatch.shared` | 12 |

A lane is a **bulkhead**. `DispatchLane.for(serviceLevel, tier)` is the entire routing rule — in the
domain, testable with no broker in sight. **Service level wins over traffic tier**: a promise made to
a large customer is worth what the same promise made to a small one is worth.

**Tiering and keying solve different halves of the same problem.** Keying gives each sender a stable
partition and stable ordering; moving a heavy sender to a different *topic* is what stops it
consuming everyone else's capacity. Both are needed.

`shared` carries the most partitions (12) despite the least traffic per customer, and that is
deliberate: it holds the long tail, so its partition count decides how many senders end up behind the
same head-of-line block. `bulk` holds few keys, each enormous, and more partitions would not spread
one sender any thinner.

**The lane is decided once, at enqueue, and stored in `sms_outbox.type`.** A retry therefore travels
the lane the message was classified into when it was accepted, rather than wherever its sender's rate
has drifted to since.

**One process, one lane.** `src/worker.ts` boots a `WorkerModule` through `createApplicationContext`
— no HTTP server, no controllers, no relay, no credit ledger. `WORKER_LANE` names the single lane a
process consumes and **throws on a missing or unrecognised value rather than defaulting**: a worker
that silently picked `SHARED` because of a typo would look healthy while its real lane went
unconsumed, which is the exact outage the lanes exist to prevent. A single process consuming all
three would put express messages and a bulk backlog on the same event loop and the same connection
pool — the arrangement this decision exists to avoid. Scaling a lane is more replicas of that lane's
container.

**Retry budgets are per lane, because a consumer retrying in place blocks its partition.** Express
retries three times with a 200 ms base; standard lanes retry five times with a 1 s base. That makes
it a latency decision, not a reliability one: a message that spends four of its five promised minutes
backing off has already broken the promise.

The business justification is that the express guarantee is a product feature customers are charged
more for, and separate capacity is the only thing that makes it a guarantee rather than a hope. The
bulk/shared split protects the small customers who are the larger share of the customer base.

## Consequences

Three worker containers per stack, six with both stacks up, plus a broker each. That is the operating
cost of the isolation, and it is most of the reason a `make up` starts twelve containers.

The workers wait for `app` to be healthy, and that is a **build** dependency, not a runtime one:
`dist/` is on a shared bind mount and `app`'s `nest start --watch` is what compiles `worker.js`. So a
code change needs the workers restarted, where `app` hot-reloads. A production image would bake the
build in and the edge disappears.

`KafkaTopicProvisioner` runs on `onModuleInit`, **and that is not a stylistic choice.** Nest runs
every `onApplicationBootstrap` in a module *concurrently*, so listing the provisioner before the
consumer in `providers` orders nothing. When both used that hook, `consumer.subscribe()` won, asked
for metadata on a topic that did not exist, and — with auto-creation disabled — was answered
`UNKNOWN_TOPIC_OR_PARTITION`. That killed the worker and the half-finished provisioner with it, so no
topics were created, all three lanes stayed dead on every fresh broker, and the suite's reporting
scenarios timed out waiting for a delivery nobody was going to make. Nest awaits all `onModuleInit`
hooks before any `onApplicationBootstrap`; that is the only ordering guarantee available.

Provisioning **fails the boot rather than warning**. The API must start without a broker because it
has an outbox to accept sends into; a worker without its topic can do nothing at all. Failing loudly,
plus `restart: unless-stopped`, is what makes a cold start self-heal. Note what does not help:
`docker compose up --wait` reports a worker healthy the moment it is running, because the workers
carry no healthcheck.

`SmsDispatchConsumer.handle` **never throws**. An exception out of `eachMessage` makes kafkajs retry
the same offset indefinitely, so one permanently bad message would stop the lane for everything
behind it. A message id that no longer exists is tolerated and committed — delivery is at-least-once
(ADR 9), so a redelivery can arrive after the row was cleaned up.

Partition counts are fixed at provisioning. Changing them later is an operational task Kafka makes
awkward, and reducing them is not possible at all.

A dead-letter topic per lane is the obvious next step if carrier outages ever outlast these budgets.
It is deliberately not built: it triples the topic count to solve something the stand-in carrier
cannot yet demonstrate (ADR 17).

`GET /api/sms/traffic` publishes a sender's classification but **no lane, no topic and no worker**.
Separate capacity is the promise; the mechanism is ours to change.

## Compliance

- `sms/domain/value/dispatch-lane.spec.ts` — the routing rule, including service level winning over
  tier.
- `sms/infrastructure/kafka/topics.spec.ts` — topic naming and partition configuration.
- `sms/infrastructure/worker/sms-dispatch-consumer.spec.ts` — the consumer driven through a fake
  broker, including that it never throws.
- **`WORKER_LANE` failing the boot is itself a fitness function**: a misconfigured worker cannot start
  and pretend to be healthy. It is enforced at runtime, on every deploy, rather than in CI.

The acceptance suite's `high-volume-senders.feature` covers the classification that feeds the routing,
though not the lane isolation itself — proving that a blast does not delay a confirmation would need a
load test this suite does not attempt.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-31 · Last modified: 2026-07-31

Related: ADR 9 (the outbox the lanes publish from), ADR 11 (how a sender gets a tier), ADR 12 (the
race the second writer introduced), ADR 17 (the deferred circuit breaker and dead-letter topics).
