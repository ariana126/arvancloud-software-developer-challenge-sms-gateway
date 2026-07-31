# Requirements → Implementation → Proof

What the brief asked for, where each requirement lives in the code, and which test proves it.

The brief is quoted **verbatim in Persian**, with an English rendering beneath it. The full,
untouched text is in the [appendix](#appendix-the-brief-as-received).

Two of the requirements are architecture characteristics rather than features — they have no endpoint
and no screen. Those are handled honestly below: one is demonstrated, the other is **designed for and
never measured**, and this document says which is which.

---

## Summary

| # | Requirement | Status |
| --- | --- | --- |
| A | Send an SMS to any number | Built · proved by acceptance test |
| B | View a report of sent messages | Built · proved by acceptance test |
| C | Each user has a limited SMS credit | Built · proved by acceptance test |
| D | Credit must be topped up before sending | Built · proved by acceptance test |
| 1 | ~100 million SMS/day, tens of thousands of businesses | **Designed for · not demonstrated** |
| 2 | Non-uniform send rates between customers | Built · proved by acceptance test |
| 3 | Express service with a guaranteed delivery time to the operator | Built · proved by acceptance test |
| 4 | Entire balance usable; nothing accepted once exhausted | Built · proved by acceptance test |
| 5 | Users can obtain reports of their sent messages | Built · proved by acceptance test |

Nine requirements, eight of them with a black-box test that fails if the behaviour regresses. The
ninth is requirement 1, and it is the one worth reading carefully.

---

## From the introduction

### A. Send an SMS to any number

> این سیستم به کاربران اجازه می‌دهد تا برای هر شماره دلخواه پیامک ارسال کنند

*This system allows users to send an SMS to any number they choose.*

| | |
| --- | --- |
| **API** | `POST /api/sms` |
| **Screen** | `/send-sms` |
| **Domain** | `SmsMessage` aggregate; `PhoneNumber` and `MessageBody` value objects |
| **Proof** | `specs/sms-sending/send-sms.feature` — *Successful send with sufficient credit* |

The recipient is normalised by `PhoneNumber` on the way in and stored in that form, so a report reads
back what was validated rather than what was typed.

### B. View a report of sent messages

> و گزارش پیامک‌های ارسالی را مشاهده کنند

*…and view a report of the messages they have sent.*

| | |
| --- | --- |
| **API** | `GET /api/sms` |
| **Domain** | `GetSentSmsReport` query → `SentSmsReportRepository` port |
| **Proof** | `specs/reporting/view-sent-sms-report.feature` — *Viewing the report after sending an SMS*, and *Not seeing other users' SMS in the report* |

The second scenario is the one that matters: the `senderId` predicate is applied in the query, not
after it, so one customer cannot read another's messages.

The report filters on `SENT`, so it never announces a message that is still queued or that was
dead-lettered — see [ADR 12](adr/0012-queued-state-with-forward-only-transitions.md), which exists
because that filter once reported delivered messages as undelivered.

### C. Each user has a limited SMS credit

> هر کاربر موجودی پیامک محدودی دارد

*Each user has a limited SMS credit.*

| | |
| --- | --- |
| **API** | `GET /api/credit`, `GET /api/sms/pricing` |
| **Domain** | `Wallet` aggregate; `Money`, `Amount`, `Currency` value objects; `SmsTariff` |
| **Proof** | `specs/credit/increase-credit.feature`; `wallet.aggregate.spec.ts`, `money.spec.ts`, `amount.spec.ts`, `currency.spec.ts` |

One SMS costs a flat **1,000 rials** (`SmsTariff.COST_PER_SMS_IN_RIALS`), and that constant is the
single place the price lives — the send path and `GET /api/sms/pricing` both read it, so a published
price cannot disagree with a charged one.

### D. Credit must be topped up before sending

> و برای ارسال پیامک ابتدا باید موجودی خود را افزایش دهد

*…and must first increase their credit in order to send an SMS.*

| | |
| --- | --- |
| **API** | `POST /api/credit/increase` |
| **Domain** | `CreditLedger` — a published port on the `credit` module, charged by `sms` inside the send transaction |
| **Proof** | `specs/credit/increase-credit.feature` — *Successfully increasing account credit* |

`sms` charges credit through a narrow port rather than by importing the `credit` module — see
[ADR 6](adr/0006-cross-module-dependencies-through-published-ports.md). That port is what lets the
debit and the message write commit together.

---

## The numbered requirements

### 1. Scale — ~100 million SMS per day

> این سیستم به چند ده هزار کسب‌وکار سرویس می‌دهد که باعث شده در روز حدود ۱۰۰ میلیون پیامک را دریافت و برای اپراتورها ارسال کند.

*This system serves several tens of thousands of businesses, which means it receives and sends around
100 million SMS per day to the operators.*

**Status: designed for, not demonstrated.** No load test was run. No throughput figure is claimed.
About 100 million per day is roughly **1,157 sends per second on average**, and peak is higher than
average. What follows is what the architecture does about that, and it is a design argument rather
than a measurement.

**Accepting a send is decoupled from delivering it.** `POST /api/sms` commits one transaction — the
charge, the traffic count, the message row and an outbox row — and then hands the message to the
broker *outside* that transaction. The request never waits on the operator, so accept-rate is bounded
by Postgres rather than by a carrier's latency.
See [ADR 9](adr/0009-transactional-outbox-for-dispatch.md).

**Delivery scales horizontally.** Each lane is its own topic, partitioned (6/6/12) and keyed by
`senderId`, consumed by its own worker process. Adding capacity to a lane is adding replicas of one
container; the partition count bounds how far that goes.
See [ADR 10](adr/0010-three-kafka-dispatch-lanes.md).

**Nothing is polled that does not need to be.** The traffic counter is a single
`INSERT … ON CONFLICT DO UPDATE` that also rolls its own window over, so there is no sweeper and no
cron competing with the send path.
See [ADR 11](adr/0011-derive-traffic-tier-at-read-time.md).

**Where this requirement is not met, and it is the honest headline of this document.** At 100 million
messages per day, `sms_message` grows by 100 million rows daily, and the report of requirement 5 is a
`findMany` against the **primary** database with a single `senderId` index — competing with the
guarded status writes that requirements 4 and 5 depend on. Separating that read load is the single
change this brief most clearly forces, and it was **deliberately deferred**:
[ADR 16](adr/0016-serve-the-report-from-the-write-database.md) records the alternatives, why deferring
was cheap, and the trigger for revisiting it.

**Proof: none, deliberately.** The correct evidence for this requirement is a load test, and writing
a bad one would be worse than admitting there is none. What can be said is that the design has no
known barrier at this order of magnitude — not that it has been shown to reach it.

### 2. Non-uniform send rates between customers

> توزیع پیامک‌های ارسالی از سمت این مشتریان یکسان نیست؛ یعنی مشتریانی با نرخ ارسال بسیار بالا و مشتریانی با نرخ ارسال بسیار پایین از این سرویس استفاده می‌کنند.

*The distribution of messages sent by these customers is not uniform — customers with very high send
rates and customers with very low send rates both use this service.*

This is the noisy-neighbour problem, and it is the requirement the dispatch design exists for.

| | |
| --- | --- |
| **API** | `GET /api/sms/traffic` — publishes a customer's classification, count, window and threshold |
| **Domain** | `TrafficTier.forSendCount` classifies against a `TrafficPolicy`; `DispatchLane.for(serviceLevel, tier)` routes |
| **Persistence** | `sms_sender_traffic` — one row per sender, a rolling window, incremented and rolled over in one statement |
| **Proof** | `specs/sms-sending/high-volume-senders.feature` — three scenarios; `dispatch-lane.spec.ts`; `traffic-tier.spec.ts` |

A heavy sender is moved to its **own topic** (`BULK`), away from the long tail (`SHARED`). Keying by
`senderId` alone would not have been enough: a key gives each customer a stable partition and stable
ordering, but it cannot stop one enormous sender from filling the partition it hashes to along with
everyone else who hashed there. Tiering and keying solve different halves of the same problem.

`shared` carries the **most** partitions (12) despite the least traffic per customer, because it holds
the long tail and its partition count decides how many small senders end up behind the same
head-of-line block.

The tier is **never stored** — it is derived from a configured threshold, so changing the threshold
reclassifies everyone at once instead of leaving a table of stale verdicts behind.

The third scenario — *One customer's volume does not reclassify another customer* — is the one that
would catch a shared-counter defect, which is the way this requirement is most likely to be broken
silently.

See [ADR 10](adr/0010-three-kafka-dispatch-lanes.md) and
[ADR 11](adr/0011-derive-traffic-tier-at-read-time.md).

### 3. Express service with a guaranteed delivery time to the operator

> این سامانه برای رفع برخی نیازهای خاص مانند پیامک‌های رمز پویا، یک سرویس پیامک اکسپرس نیز ارائه می‌دهد که تضمین مدت‌زمان تحویل پیامک به اپراتور در حالت اکسپرس باید به مشتری ارائه شود.

*To meet certain specific needs such as one-time-password messages, the system also offers an express
SMS service, and in express mode a guarantee of the delivery time to the operator must be given to
the customer.*

| | |
| --- | --- |
| **API** | `POST /api/sms` with an express service level; the 201 carries `guaranteedDeliveryAt` |
| **Domain** | `ServiceLevel` owns a **5-minute** window (`EXPRESS_DELIVERY_WINDOW_IN_MINUTES`) |
| **Dispatch** | A dedicated `EXPRESS` topic and worker; **service level beats traffic tier**, so a large customer's express message is still express |
| **Proof** | `specs/sms-sending/send-express-sms.feature` — *Successful express send shows the delivery-time guarantee*; `service-level.spec.ts` |

Three details the brief's wording drove:

**The guarantee is to the operator, not to the handset** — exactly as the brief says. `sentAt` is when
the send was *accepted*, and the guarantee is measured from there, so the promise does not slide
when a carrier is slow.

**`guaranteedDeliveryAt` is derived, never stored.** `ServiceLevel` owns the window, and a persisted
copy would be free to disagree with the rule that produced it.

**The express retry budget is tighter than the standard one** — three attempts with a 200 ms base,
against five attempts with a 1 s base. That makes retry a latency decision rather than a reliability
one: a message that spends four of its five promised minutes backing off has already broken the
promise.

**Limitation, stated plainly:** the guarantee is **measured, not enforced**. `warnIfLate` recomputes
the deadline and logs a warning when a delivery lands past it; nothing prevents a breach. A guarantee
nobody measures is one nobody knows they are breaking — but measurement is not prevention, and this
document should not imply otherwise. It is also protected against internal queueing only, not against
carrier failure; see requirement-level note 3 below and
[ADR 17](adr/0017-no-circuit-breaker-around-the-sms-provider.md).

### 4. Entire balance usable, nothing accepted once exhausted

> مشتریان باید بتوانند تمام میزان موجودی حساب خود را برای ارسال پیامک استفاده کنند و هیچ پیامکی پس از اتمام موجودی نباید از مشتری دریافت شود.

*Customers must be able to use the entire balance of their account for sending messages, and no
message may be accepted from a customer once their balance is exhausted.*

Two clauses, and they pull in opposite directions: spend down to exactly zero, but never past it. A
naive implementation satisfies one and breaks the other under concurrency.

| | |
| --- | --- |
| **Domain** | `Wallet.decrease` fails fast with the numbers a client needs |
| **Persistence** | `PrismaWalletRepository` writes a **conditional delta** — `balance = balance - amount` guarded by `balance >= amount`; zero rows updated means a concurrent writer got there first, and becomes `InsufficientCredit` |
| **API** | `402` with an RFC 9457 problem document |
| **Proof** | `specs/sms-sending/send-sms.feature` — *Using all remaining credit to send an SMS*, *Two sends at the same moment cannot both spend the same credit*, *Rejecting a send due to insufficient credit*; `wallet.aggregate.spec.ts`, `wallet.repository.spec.ts` |

The three scenarios map one-to-one onto the requirement: the first proves the balance can be spent to
exactly zero, the third proves nothing is accepted after that, and the second proves both still hold
when two requests arrive at the same instant.

**The guard is stated twice on purpose.** Persisting the aggregate's whole state would be a lost
update — two requests read 1,000, both subtract in memory, both write 200, and one SMS has been given
away. The aggregate reasons about the row it read; a row it read a moment ago is exactly what a
racing writer invalidates. There is no version column and no retry loop, because a conditional write
does not race.
See [ADR 8](adr/0008-guarded-sql-deltas-for-concurrent-state.md).

The charge and the message write **commit together**, so money can never be taken without a record of
what it was taken for — the failure the brief's second clause is really about.

### 5. Users can obtain reports of their sent messages

> کاربران باید بتوانند گزارشات پیامک ارسالی خود را دریافت کنند.

*Users must be able to obtain reports of the messages they have sent.*

Implemented as requirement B above. Two things specific to this being a *requirement* rather than an
introductory sentence:

**A message appears in the report when it has actually gone out**, not when it was accepted. The
report filters on `SENT`, which a worker writes on the far side of the broker — so the report never
announces a message still sitting on a partition, still in the outbox, or dead-lettered after the
operator refused it for good.

**That correctness was bought after it was broken.** Before the status write was guarded, forty
concurrent sends left 39 of 45 delivered messages permanently reported as undelivered.
[ADR 12](adr/0012-queued-state-with-forward-only-transitions.md) records the incident, the fix, and —
honestly — the half of the fix that still has no automated test.

**Proof**: `specs/reporting/view-sent-sms-report.feature`, two scenarios.

---

## Built but not requested

**Registration and authentication.** `POST /api/users`, `POST /api/auth/login`, `GET /api/users/me`,
the `identity` module and `specs/registration/sign-up.feature` (17 of the suite's 28 examples).

The brief never asks for sign-up. It presupposes it — "each user has a limited SMS credit" requires a
user, and "customers must be able to use their entire balance" requires knowing whose balance. It is
listed separately rather than as a satisfied requirement, because counting it as one would overstate
the mapping.

---

## What has a screen, and what does not

Every requirement above is met by the API. **Not all of them have a user interface**, and the brief
does not ask for one — it says users must be able to *send* messages and *obtain* reports, which the
API satisfies. Stated here so nothing has to be discovered.

| Capability | API | Screen |
| --- | --- | --- |
| Sign up, log in, view profile | yes | `/sign-up`, `/login`, `/profile` |
| Send an SMS, standard or express | yes | `/send-sms` |
| Top up account credit | yes | **none** |
| Read the sent-SMS report | yes | **none** |
| See your traffic classification | yes | **none** |
| Look up the price of one SMS | yes | **none** |

The frontend exists to demonstrate that the API is usable by a real client and to give the acceptance
suite a browser door for the scenarios where the UI is the risk — six of the twenty-eight examples.
Building screens for the remaining capabilities would have added UI without adding evidence about the
part of this brief that is actually hard, which is requirement 1.

---

## Deliberately out of scope

Each of these is a decision with a written rationale and a trigger for revisiting it, not an
omission. The full argument is in the linked record.

**Separating report reads from the write database** —
[ADR 16](adr/0016-serve-the-report-from-the-write-database.md). The report is served by a `findMany`
against the primary, competing with the send path's writes. This is the deferral most directly forced
by requirement 1, and it is cheap to reverse because the read side is already a separate port that
does not extend the write-model repository. *Revisit when report p99 latency becomes user-visible, or
lock contention appears on `sms_message`.*

**A circuit breaker around the operator** —
[ADR 17](adr/0017-no-circuit-breaker-around-the-sms-provider.md). Retry budgets are sized for an
operator that *refuses a message*, not one that is *down*; with the operator unreachable, every
message on a partition burns its full budget in sequence, and a carrier outage becomes head-of-line
blocking for the lane. Not built because a resilience mechanism tuned against a stand-in that never
fails is tuned against nothing. *Revisit when `LoggingSmsProvider` is replaced by an adapter that
performs network I/O — it should be a precondition of that change.*

**The operator itself is a stand-in.** `LoggingSmsProvider` writes a log line. `SmsProvider` is the
port a real integration plugs into, and it takes the message id as an idempotency key because
delivery is at-least-once.

**A dead-letter topic per lane.** Deliberately not built: it triples the topic count to solve
something the stand-in operator cannot yet demonstrate. Same trigger as the circuit breaker.

**Not built and not asked for**: rate limiting or quotas beyond credit, delivery receipts from the
operator, message scheduling, multi-currency pricing, and refunding a dead-lettered message
automatically — the last of these deliberately, since reimbursing from the code path that has just
failed five times is how a bug becomes money.

---

## How to check any of this

Every claim above is executable.

```bash
make run-acceptance-tests      # the 28 examples, black-box, over HTTP and through a browser
make open-living-documentation # the same scenarios rendered as a browsable site
make run-unit-tests            # the domain rules cited above
```

The living documentation for the latest `main` is published at
<https://ariana126.github.io/arvancloud-software-developer-challenge-sms-gateway/>. It is generated
from the runs themselves, so it cannot drift from what the tests actually do.

---

## Appendix: the brief as received

```
سامانه ارسال پیامک

فرض کنید طراحی و پیاده‌سازی یک SMS Gateway ساده به شما واگذار شده است. این سیستم به کاربران اجازه می‌دهد
تا برای هر شماره دلخواه پیامک ارسال کنند و گزارش پیامک‌های ارسالی را مشاهده کنند. هر کاربر موجودی پیامک
محدودی دارد و برای ارسال پیامک ابتدا باید موجودی خود را افزایش دهد.

نیازمندی‌های این سامانه

۱. این سیستم به چند ده هزار کسب‌وکار سرویس می‌دهد که باعث شده در روز حدود ۱۰۰ میلیون پیامک را دریافت و
   برای اپراتورها ارسال کند.
۲. توزیع پیامک‌های ارسالی از سمت این مشتریان یکسان نیست؛ یعنی مشتریانی با نرخ ارسال بسیار بالا و
   مشتریانی با نرخ ارسال بسیار پایین از این سرویس استفاده می‌کنند.
۳. این سامانه برای رفع برخی نیازهای خاص مانند پیامک‌های رمز پویا، یک سرویس پیامک اکسپرس نیز ارائه
   می‌دهد که تضمین مدت‌زمان تحویل پیامک به اپراتور در حالت اکسپرس باید به مشتری ارائه شود.
۴. مشتریان باید بتوانند تمام میزان موجودی حساب خود را برای ارسال پیامک استفاده کنند و هیچ پیامکی پس از
   اتمام موجودی نباید از مشتری دریافت شود.
۵. کاربران باید بتوانند گزارشات پیامک ارسالی خود را دریافت کنند.
```
