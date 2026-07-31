# 5. DDD + CQRS Vertical Slices, With Layer Boundaries Enforced by a Linter

## Status

Accepted — 2026-07-28 (`bb9ff6c`).

## Context

The domain here is small — send an SMS, charge a wallet, register a user — but it is not trivial. A
send touches money, and money has rules that must hold under concurrency (ADR 8). Those rules are the
part of the system most worth protecting from a framework upgrade, an ORM change, or a broker
arriving three commits later (which is exactly what happened).

The choices were:

- **A conventional NestJS layout** — `controllers/`, `services/`, `entities/` — with business logic
  in injectable services and Prisma models as the domain types. Fastest to write; the domain becomes
  a set of ORM rows with methods, and every rule ends up in a service that also knows about HTTP.
- **DDD tactical patterns without CQRS.** Aggregates and repositories, but one service interface
  handling both reads and writes. The read side then either rehydrates aggregates to build DTOs, or
  quietly grows a second, undeclared path.
- **DDD + CQRS as vertical slices.** A directory per module; inside it, `domain/`, `application/`
  and `infrastructure/`; commands and queries as separate handlers on a bus.

The real question was not which layout to draw but **what stops it eroding**. A layered architecture
whose layers are a convention lasts until the first deadline. Structure erodes silently, no review
catches it reliably, and this repository has an additional reason to care: much of the code is
written by AI agents, at a rate no human review keeps up with.

## Decision

We will implement DDD + CQRS with a strict layered structure, one vertical slice per module, and we
will enforce the layer boundaries with **dependency-cruiser** as a fitness function.

Each module under `src/modules/<domain>/` has three layers:

```
domain/            Pure business logic — aggregates, value objects, events,
                   and the port interfaces they need. No framework imports.
application/       Command handlers, query handlers with read-model DTOs,
                   application exceptions.
infrastructure/    The NestJS module, HTTP controllers and DTOs, Prisma
                   repositories and mappers, port implementations.
```

`src/framework/` holds what is genuinely shared and domain-free: `AggregateRoot`, `ValueObject`,
`Identity`, `Email`, `EntityRepository`, `UnitOfWork`, `Clock`, the RFC 9457 error pipeline (ADR 7),
auth, and Prisma wiring.

**Seven rules make it real**, in `backend/.dependency-cruiser.cjs`, run by `make lint-architecture`:
no cycles; the `domain` layer may not import `application` or `infrastructure`; the `domain` layer
may not import NestJS, Prisma or `kafkajs`; `application` may not reach into `infrastructure`;
`framework` may not import a feature module; modules may not import each other (with one carve-out —
ADR 6); and no file under `src/framework/{domain,application,infrastructure}/` may import its own
package barrel.

The rules are the decision. Without them this is a folder convention; with them it is a constraint,
and the difference is visible on the day someone needs a `PrismaService` inside an aggregate and
discovers they cannot have one.

Two consequences of that purity are worth stating because they were bought at a price. `UnitOfWork`
is a domain port that carries **no transaction handle** — `PrismaUnitOfWork` puts the transaction in
an `AsyncLocalStorage` that `PrismaService.client()` reads, so repositories join it without being
told and no port grows a Prisma-shaped parameter. And `Clock` is a domain port for the same reason:
a rule that depends on the current time cannot be tested if it reads the machine clock.

The business justification is the cost of change. This system's requirements moved three times in
four days — express service levels, then a report, then a broker with three dispatch lanes. The
broker is the proof: `SmsDispatchPublisher` was written as a seam, `KafkaSmsDispatchPublisher`
arrived through it, and the outbox table, claim query, retry policy, transaction and entire domain
were untouched by the swap. That is what the structure was bought for, and it paid.

## Consequences

There is more ceremony per feature than a conventional NestJS layout: a slice means an aggregate,
value objects, a port, a command, a handler, a controller, a DTO, a repository, a mapper and an
exception mapper. For a two-field CRUD endpoint that is straightforwardly too much. The system has
none of those, which is why the trade was worth taking here and would not be everywhere.

The rules occasionally forbid the obvious thing, and the error message names a rule rather than
explaining the design. `no-own-package-barrel` is the least obvious of the seven and the easiest to
trip: importing your own barrel creates a load-order cycle that crashes at *runtime*, not at build
time. Import the sibling module directly.

Two mechanics surprise people when a rule fires unexpectedly. `no-circular` ignores cycles routed
through an `index.ts`. And `tsPreCompilationDeps` is on, so a type-only `import type` still counts as
a dependency — a domain file cannot even name a Prisma type.

`*.spec.ts` files are excluded from the graph entirely, so a test may reach anywhere.

One documented exception is whitelisted: `HttpExceptionFilter` composes the module exception mappers
(ADR 7), which is `framework` naming feature modules. It is a real violation of the fifth rule,
accepted because the alternative — a DI-registered mapper collection — cannot work for a filter
constructed with `new`.

The barrels are load-bearing. `identity.module.ts` spreads `Controllers`, `CommandHandlers` and
`QueryHandlers` rather than listing each, which is also why ESLint's `injectable-should-be-provided`
rule is switched off.

The `identity` module is the reference implementation for *structure* and carries no tests at all.
Copy its shape; copy `sms` for test coverage.

## Compliance

`make lint-architecture` — dependency-cruiser, seven rules, its own CI job. It runs in a throwaway
container and needs nothing up.

This is the clearest fitness function in the repository: the decision is not a document that
describes the architecture, it is a rule set that fails the build when the architecture is violated.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-28 · Last modified: 2026-07-31

Reconstructed after the fact. The rule set grew: `49fff40` added the cross-module carve-out (ADR 6)
and `e564c9e` added `kafkajs` to the list of things the domain may not import.
