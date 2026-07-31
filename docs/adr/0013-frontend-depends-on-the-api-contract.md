# 13. The Frontend Depends on the API Contract, Not the Backend Project

## Status

Accepted — 2026-07-28 (`bb9ff6c`).

## Context

The Angular application needs typed access to the API: request and response types, and functions that
call the right routes. Those types are already described by the backend's OpenAPI specification,
which is generated from the controllers and DTOs and committed.

ADR 2 keeps the projects independent — no workspace, no shared `node_modules`, no module resolution
path from one to the other. The question is how the front end gets the contract without acquiring a
dependency on the backend *project*.

The alternatives:

- **Hand-written types and `fetch` calls.** No coupling and no guarantee: the types drift from the API
  the day someone renames a field, and nothing says so.
- **A shared types package.** Correct types, at the cost of a build-order dependency between the two
  projects and a publish step — reintroducing the coupling ADR 2 removed.
- **Generate the client from `../backend/docs/openapi.json`.** Accurate and cheap, and it makes
  `frontend/` unbuildable in isolation: one relative path out of the project and the independence is
  gone.
- **Keep a copy of the spec inside `frontend/`, generate from that, and check the copy for drift.**

## Decision

We will keep the front end's own copy of the contract at `frontend/api/openapi.json`, generate the
HTTP client from it with **orval**, and enforce that the copy matches the backend with a root-level
check.

Nothing under `frontend/` ever resolves a path into `backend/`. The project builds if copied
elsewhere. The dependency is on a *contract* — a JSON file — not on a project.

Two gates compose to make this safe:

1. **`make lint-swagger`** proves `backend/docs/openapi.json` matches the backend code. It rebuilds
   the document in memory and compares it to what is on disk.
2. **`make lint-api-contract`** proves `frontend/api/openapi.json` matches that file. It is a bare
   `cmp` between two files in the checkout — the one CI job that needs no container at all, which is
   why `make run-guardrails` runs it first.

Together they guarantee the generated client matches the running API. Neither alone would: the first
says nothing about the copy, the second says nothing about the code.

`make sync-api-contract` copies the spec across; `make fix-violations` runs it **last**, after
`generate-swagger`, so the copy is always taken from an already-regenerated spec.

The generated client is **gitignored and rebuilt** by npm `pre*` hooks on every start, build, test and
lint. It is never hand-edited — a `.claude/hooks/` guard denies Write and Edit on
`frontend/src/app/api/*` and names the command to run instead.

The same reasoning governs runtime. The generated client emits **relative** routes, and
`frontend/proxy.conf.mjs` forwards `/api` to whatever `API_PROXY_TARGET` names — a URL, not a path,
and the only place in the project the backend's address appears. It is `host.docker.internal`
because the two projects share no Docker network: the backend is reachable only through the ports it
publishes on the host.

The business justification is the cost of a contract break reaching a user. A renamed field caught by
`cmp` in CI costs seconds; the same break caught in the browser costs a bug report, and in this
system it would land on a form that takes a customer's money.

## Consequences

Two copies of the spec exist and can diverge — that is the thing `lint-api-contract` is for, and the
one thing this design accepts in exchange for independence. A backend change that touches a
controller or DTO requires `make fix-violations` from the repository root, not just
`make generate-swagger` in the backend, or the check fails on a file the backend does not own.

The generated client is not in version control, so a fresh clone has no `frontend/src/app/api/`
until an npm script runs. The `pre*` hooks make that automatic for every entry point that needs it,
including lint — which is why the hook list is six entries long rather than one.

The front end cannot use an API capability the spec does not describe. That is the intended
constraint and it has teeth: the testing endpoints are deliberately absent from the spec (ADR 4), so
the front end could not call them even if someone wanted to.

`proxy.conf.mjs` is `.mjs` rather than `.json` because it reads an environment variable, and it lives
beside `src/` rather than in an Angular `environment.ts` because the target is a deployment fact, not
a build-time constant.

## Compliance

`make lint-swagger` and `make lint-api-contract`, each its own CI job.

This is the cleanest fitness function in the repository after `lint-architecture`, because the second
check is a byte comparison: there is no interpretation, no partial match, and no way for it to pass
while the contract has drifted.

The generated-file guard hook denies hand edits to `frontend/api/openapi.json` and
`frontend/src/app/api/*`, naming the regenerating command. Note it covers Write and Edit only — a
shell redirect can still write those paths, deliberately, because `make generate-swagger` legitimately
rewrites them through a bind mount.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-28 · Last modified: 2026-07-31

Reconstructed after the fact.
