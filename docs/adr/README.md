# Architecture Decision Records

Why this system is shaped the way it is. Each record states one decision, the alternatives that were
rejected, what it cost, and what enforces it.

**ADRs own *why*; `CLAUDE.md` files own *how*.** A `CLAUDE.md` tells you the commands, conventions and
traps of the code you are about to touch. An ADR tells you why the constraint exists and what it
would take to overturn it. Each `CLAUDE.md` section that discusses a decision links to the ADR that
owns it.

Start with [ADR 1](0001-record-architecture-decisions-in-adrs.md), which explains the template and
the division above.

## The decisions

| # | Decision | Status |
| --- | --- | --- |
| [1](0001-record-architecture-decisions-in-adrs.md) | Record Architecture Decisions in ADRs | Accepted |
| [2](0002-monorepo-of-independent-projects.md) | A Monorepo of Independent Projects, Each With Its Own Build and Stack | Accepted |
| [3](0003-makefile-is-the-only-build-interface.md) | The Makefile Is the Only Build Interface; CI Runs One Job Per Target | Accepted |
| [4](0004-second-application-stack-for-tests.md) | A Second Application Stack for Tests, Gated on `NODE_ENV` | Accepted |
| [5](0005-ddd-cqrs-with-enforced-layer-boundaries.md) | DDD + CQRS Vertical Slices, With Layer Boundaries Enforced by a Linter | Accepted |
| [6](0006-cross-module-dependencies-through-published-ports.md) | Cross-Module Dependencies Go Through a Published Port Surface | Accepted |
| [7](0007-rfc-9457-problem-details.md) | RFC 9457 Problem Details for Every Error Response | Accepted |
| [8](0008-guarded-sql-deltas-for-concurrent-state.md) | Write Concurrent State as Guarded SQL Deltas, Never Read-Modify-Write | Accepted |
| [9](0009-transactional-outbox-for-dispatch.md) | Dispatch Through a Transactional Outbox, With the Broker Outside the Transaction | Accepted — superseded in part by 12 |
| [10](0010-three-kafka-dispatch-lanes.md) | Three Isolated Kafka Dispatch Lanes, One Worker Process Each | Accepted |
| [11](0011-derive-traffic-tier-at-read-time.md) | Derive the Traffic Tier at Read Time Rather Than Storing It | Accepted |
| [12](0012-queued-state-with-forward-only-transitions.md) | A `QUEUED` State, With Forward-Only Transitions Enforced Twice | Accepted — supersedes 9 in part |
| [13](0013-frontend-depends-on-the-api-contract.md) | The Frontend Depends on the API Contract, Not the Backend Project | Accepted |
| [14](0014-acceptance-suite-uses-two-public-doors.md) | The Acceptance Suite Reaches the System Through Two Public Doors Only | Accepted |
| [15](0015-locate-ui-elements-by-accessible-name.md) | Locate UI Elements by Accessible Name, Not Test Attributes | Accepted |
| [16](0016-serve-the-report-from-the-write-database.md) | Serve the Sent-SMS Report From the Write Database, For Now | **Accepted — deferred implementation** |
| [17](0017-no-circuit-breaker-around-the-sms-provider.md) | No Circuit Breaker Around the SMS Provider, For Now | **Accepted — deferred implementation** |

### The two deferrals

**16 and 17 record work that was deliberately not done**, and both are cut against a submission
deadline rather than a technical objection. They are here because an undocumented gap reads as an
oversight, while a dated deferral with an explicit trigger is a decision.

Each carries a `Revisit when:` line naming a concrete, observable trigger, and a Compliance section
saying what would tell us the moment has arrived. Neither is cheap to defer by accident — in both
cases the seam that makes the reversal a single-class change already exists in the code, and both
records say which class it is.

## Where to start, by interest

- **How a send works end to end** — 9, then 10, then 12.
- **How money stays correct under load** — 8, then 12.
- **How the codebase is kept from eroding** — 5, then 6, then 3.
- **How the system is tested** — 14, then 4, then 15.
- **What is knowingly missing** — 16 and 17.

## The template

Seven sections: Nygard's five plus the Compliance and Notes sections Richards and Ford add.

| Section | Contents |
| --- | --- |
| **Title** | Sequentially numbered, descriptive enough to remove ambiguity |
| **Status** | `Proposed`, `Accepted`, or `Superseded`, with the supersession trail |
| **Context** | The forces at play, and the alternatives that were rejected |
| **Decision** | Commanding voice, with a technical *and* a business justification |
| **Consequences** | The impact, good and bad, including the trade-off analysis |
| **Compliance** | How the decision is measured and governed |
| **Notes** | Author and dates |

## Conventions

**Numbering** is sequential and permanent. A number is never reused, and a superseded record is never
deleted — the trail is what stops a settled debate from restarting.

**Filenames** are `NNNN-kebab-case-title.md`, zero-padded to four digits.

**Superseding is bidirectional.** Never edit an accepted decision's Decision section in place. Write
a new ADR, mark the old one `Superseded by N`, and mark the new one `supersedes M`. ADRs 9 and 12 are
the worked example: 9 established the outbox on the premise that a successful publish meant delivery,
and 12 is what broke that premise. The outbox itself survived unchanged.

**Compliance names a real gate**, or says plainly that there is none. An honest "no automated gate" is
worth more than an invented one — see ADR 12, where writing this section is what surfaced that the
half of the enforcement whose absence caused a customer-visible defect is still the half nothing
would catch.

**A business justification is mandatory.** If a decision has none, it is guidance rather than a
decision, and it belongs in a `CLAUDE.md`.

## A note on how these were written

These records were written **retrospectively**, after the decisions they describe. That is the honest
framing, and it has a cost worth knowing while reading: reconstructed reasoning is kinder to the
author than the original deliberation was. Where a record is a reconstruction rather than a
contemporaneous note, its Notes section says so.
