# 4. A Second Application Stack for Tests, Gated on `NODE_ENV`

## Status

Accepted — 2026-07-28 (`bb9ff6c`).

## Context

The acceptance suite is a black-box client (ADR 14): it may reach the system only over HTTP and
through a browser. That constraint is what makes the suite valuable, and it creates one problem it
cannot solve on its own.

A scenario needs a clean database, and an expiry scenario needs to control the clock. Neither is
reachable through a door a real client uses. The suite cannot connect to Postgres — that would be
the third door this design refuses — and it cannot wait five minutes for a token to expire.

So the system has to expose truncation and clock control over HTTP. The question is how to guarantee
those endpoints can never be reached anywhere they would be catastrophic.

The alternatives:

- **A feature flag or environment variable guarding each endpoint.** One flag misconfigured in
  production and a stranger can truncate the database over HTTP.
- **Authentication on the testing endpoints.** Better, but it makes the blast radius a function of
  secret management, and the endpoints still exist in the production build.
- **Compile them out of the production bundle.** Correct, but the mechanism is fragile in a NestJS
  app whose modules are registered at runtime.
- **A second running stack, with the endpoints mounted only when its environment says `test`.**

## Decision

We will mount `TestingModule` into `AppModule` only when `NODE_ENV === 'test'`, and run a second
complete application stack at that value for the acceptance suite to drive.

The dev stack (`nmk-backend`) and the test stack (`nmk-backend-test`) are the same image with
different values. They differ in ports (3000/3001 for the app, 5432/5433 for Postgres, 9092/9094 for
Kafka), in their env file (`.env` / `.env.test`), in logging (`debug` / `silent`), and in Compose
project name — which is what gives each its own volumes and its own broker. Both are six services:
`app`, `db`, `kafka`, and one dispatch worker per lane (ADR 10).

`TestingModule` exposes five endpoints, all returning 204: run migrations, truncate every table, pin
the clock, advance the clock, reset the clock. **They exist on the test stack alone** — not in
development, not in production. The guarantee is a property of the module graph rather than of a
configuration value that a deployment could get wrong.

Separate ports mean both stacks run at once, which is the normal state after `make up`. That is not
a convenience: it is what makes it impossible for a suite run to touch the data a developer is
looking at.

The clock half is the same argument. `ClockModule` binds the real `SystemClock` everywhere except
`NODE_ENV=test`, where it binds a `TunableClock` the testing endpoints drive. **Nothing in a handler
or an aggregate ever calls `new Date()`** — they inject the `Clock` port — which is what makes token
expiry and the express delivery guarantee testable at all.

The business justification is trust in the test results. A suite that shares a database with
development produces failures nobody believes, and a suite nobody believes stops being run.

## Consequences

Everything is doubled: two databases, two brokers, two sets of ports, eight extra containers when
both stacks are up. On a laptop that is real memory. `make up` starts both because that is the
normal working state.

Two env files per project, from two committed examples. Every project's `setup` creates all of its
own, which is what lets the root call a plain `setup` per project without knowing the backend has a
second one.

The examples carry a trap that has caught people: each setup recipe is
`[ -f .env ] || cp .env.example .env`, **a no-op once `.env` exists**. Adding a key to an example
file therefore never reaches a developer's live `.env`. A hook
(`.claude/hooks/sync-env-examples.sh`) re-runs `setup` after an edit and warns about keys present in
an example but missing from the live file — and note from ADR 3 that CI's `paths-ignore` means
nothing verifies that hook.

`make migrate` reaches the dev stack only; it is `docker compose exec` against `nmk-backend`. The
test stack migrates itself through `POST /api/testing/migrations` in the suite's `BeforeAll` hook,
which is why `make up` does not migrate and `make run-acceptance-tests` is unaffected by that.

The committed OpenAPI spec is generated **without** `NODE_ENV=test`, so the testing endpoints are
absent from it despite carrying `@ApiTags`. That is deliberate, and it doubles as the compliance
check below.

The test stack sets `OUTBOX_RELAY_ENABLED=false`. A relay polling a database the suite truncates
between scenarios is a flake source with nothing to catch, since the stand-in carrier never fails
(ADR 17).

## Compliance

`make lint-swagger`. The committed `backend/docs/openapi.json` describes four paths; the five testing
endpoints are not among them. If `TestingModule` were ever mounted unconditionally, the regenerated
spec would gain them and the check would fail.

That is an indirect gate — it catches the mounting condition being removed, not the environment being
misconfigured — but it is a real one, and it runs on every pull request.

Direct: `grep -n "NODE_ENV" backend/src/app.module.ts` shows the condition. It is one line, and it is
the whole security property.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-28 · Last modified: 2026-07-31

Reconstructed after the fact.
