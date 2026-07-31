# 14. The Acceptance Suite Reaches the System Through Two Public Doors Only

## Status

Accepted — 2026-07-28 (`bb9ff6c`).

## Context

The acceptance suite exists to answer one question: does the system do what the business asked for?
Its value depends entirely on being able to answer that question **through a rewrite of the
implementation** — otherwise it is a change-detector, and a change-detector fails on every refactor
and catches nothing.

Every shortcut available to a test suite erodes that property, and every one of them is tempting:

- **Import the domain to build a fixture.** Now the suite fails when a constructor signature changes,
  and passes when the API that exposes it is broken.
- **Write to the database directly to set up a precondition.** Faster than driving the API, and it
  sets up states the application itself cannot produce — so scenarios pass against data no real user
  could create.
- **Read a frontend source file to learn a selector.** Couples the suite to markup internals rather
  than to what a user sees.
- **Reuse the backend's TypeScript types for assertions.** The assertion then cannot fail when the
  type is wrong, because it is the same type.

Each is locally reasonable. Together they turn a black-box suite into a white-box one, gradually and
without any single decision to blame.

## Decision

We will let the acceptance suite reach the system through **exactly two doors: the HTTP API a client
would call, and the page a person would look at.** Nothing else.

- No importing code from `backend/` or `frontend/`.
- No database access.
- No reading a frontend source file to find a locator.
- **A precondition that cannot be set up through one of those two doors does not get set up.**

That last clause is the one with teeth, and it has shaped the system rather than the suite. Two
needs could not be met through a public door — a clean database between scenarios, and control of the
clock — and the response was not to open a third door but to build them as endpoints the system
genuinely exposes, on a stack that exists for the purpose (ADR 4). The constraint pushed the
capability into the product, where it can be reasoned about, instead of into the test harness, where
it could not.

The dependency runs one way, and the repository enforces the shape: **backend and frontend code and
documentation never reference the acceptance-tests project.** The root is the only place all three
are named together. That is why this record lives in `docs/adr/` at the root rather than inside any
project.

The suite's own architecture keeps the doors honest. It uses Cucumber with Serenity/JS and the
Screenplay pattern in three layers — feature files, screenplay tasks and questions, then UI page
objects and support — with a one-directional dependency between them. Step definitions never touch
`screenplay/ui/` directly.

The one exception, stated plainly: **isolation hooks use raw `fetch`** against the testing endpoints
rather than going through the suite's own Screenplay abstractions. That is deliberate — setup and
teardown should not appear in the living documentation as though they were behaviour a customer
cares about.

The business justification is that this suite doubles as the product's living documentation,
published to GitHub Pages on every push to `main`. A document generated from tests that reach into
the implementation describes the implementation. A document generated from tests that use only the
public doors describes the product — which is the thing a stakeholder can actually read and correct.

## Consequences

Some setup is slower than it needs to be. Creating a user with credit and a send history means
several real HTTP calls where one SQL insert would do. That cost is paid once per scenario and is
the price of the guarantee.

Some states are untestable, and stay untestable. Anything the API cannot produce cannot be arranged —
a dead-lettered message, for instance, because the stand-in carrier never fails (ADR 17). The suite
does not work around that; ADR 9's retry and dead-letter paths are covered by unit tests instead,
which is the correct division.

The suite must not share types with the backend, so its assertions describe the wire format
independently. That duplication is the point: two independent descriptions of a contract can
disagree, and one description cannot.

Scenarios are slower and occasionally flakier than white-box tests. The isolation hooks — truncate,
reset the clock, fresh cast of actors per scenario — are what keep that manageable, and they are why
the test stack disables the outbox relay (ADR 9).

`make run-acceptance-tests` must bring up the backend test stack, then the **frontend test stack**,
then the suite. All three steps are load-bearing, because six examples drive a real browser at the
front end on port 4201 — pointed at the same backend the suite truncates between scenarios, not at
the developer's dev stack.

## Compliance

Manual, and mechanically checkable:

```
grep -rn "\.\./\(backend\|frontend\)" acceptance-tests/ --include=*.ts
grep -rni "prisma\|postgres\|pg\b" acceptance-tests/package.json
```

Neither should find anything. The absence of a database driver in the suite's dependencies is the
strongest single signal: the second door cannot be opened without adding one, and adding one is
visible in a lockfile diff.

The reverse direction — backend and frontend not referencing the suite — is checked the same way:
`grep -rn "acceptance-tests" backend/ frontend/ --include=*.ts --include=*.md` should find nothing.

No CI job enforces either. This is a discipline supported by structure (ADR 2 removed the module
resolution path that would make the first shortcut easy), not a gate.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-28 · Last modified: 2026-07-31

Reconstructed after the fact. Related: ADR 4 (the endpoints this constraint forced into the product),
ADR 15 (how the UI door finds its elements).
