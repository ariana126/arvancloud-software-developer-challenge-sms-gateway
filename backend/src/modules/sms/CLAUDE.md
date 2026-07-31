# SMS Module (`src/modules/sms/`)

Follow `../identity/CLAUDE.md` for the module *shape*. This file covers the one thing that is not
shape: how a send survives money, concurrency and a carrier that says no.

---

## The life of a send

```
POST /api/sms
  │
  ├─ one transaction ──────────────────────────────────────────┐
  │   CreditLedger.charge      (guarded debit — 402 if short)   │
  │   SmsMessage.queue → save  (status PENDING)                 │
  │   SmsOutbox.enqueue        (status IN_FLIGHT, attempts 1)   │
  └─────────────────────────────────────────────────────────────┘
  │ commit
  ├─ SmsDispatcher.dispatch    (in-request, best effort, never throws)
  │     ok   → outbox row deleted, message SENT
  │     fail → row rescheduled with backoff; 201 is still returned
  │
  └─ 201 { id, cost, guaranteedDeliveryAt? }

SmsOutboxRelay, every 2s, on every instance:
    claim due + abandoned rows (FOR UPDATE SKIP LOCKED) → SmsDispatcher.dispatch
```

**The transaction is the point.** Charging, recording and enqueueing commit together, so there is no
window in which money is taken for a message nobody recorded — the failure the previous
charge → deliver → save arrangement documented as accepted. The carrier is deliberately *outside*
it: a transaction held open across someone else's network keeps a wallet row locked for as long as
their network takes.

**`201` means accepted, not delivered.** A carrier that refuses does not fail the request, because
the send is paid for, recorded, and owed — the outbox row is the system's commitment to deliver it.
`SmsDispatcher.dispatch` never throws for exactly this reason.

## Message states

`SmsStatus` — `PENDING` → `SENT`, or `PENDING` → `FAILED` once we stop trying.

`PrismaSentSmsReportRepository` filters `status: 'SENT'`. Drop that predicate and the report starts
announcing messages still sitting in the outbox, and ones dead-lettered after the carrier refused
them for good.

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

## Where Kafka plugs in

`SmsDispatchPublisher` is the seam, and `ProviderSmsDispatchPublisher` is today's implementation —
it hands the dispatch straight to `SmsProvider`. A Kafka producer implements the same one-method
port and `SmsModule` changes by one line; the table, the claim query, the retry policy, the
transaction and the whole domain stay put. Dispatch becomes asynchronous at that moment, and the
`type` column becomes the topic.

**Do not move the dispatch back into the handler when that happens.** Producing to a broker from a
command handler is a dual write across Postgres and the broker with no transaction spanning them —
the charge commits and the produce fails, or the reverse. The outbox is what makes the broker
correct, not an alternative to it.
