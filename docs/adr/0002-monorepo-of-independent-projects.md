# 2. A Monorepo of Independent Projects, Each With Its Own Build and Stack

## Status

Accepted — 2026-07-28 (`bb9ff6c`).

## Context

The system is three deliverables: an HTTP API, a web client, and a black-box acceptance suite that
drives both. They have different runtimes (Node/NestJS, Node/Angular, Node/Cucumber), different
dependency trees, and different reasons to change.

The arrangements available were:

- **Three repositories.** Genuine independence, at the cost of a cross-repository dance for every
  change that touches the API contract, and no single place to run the whole thing.
- **One repository with one build.** A root `package.json`, npm workspaces, one `node_modules`, one
  lockfile. Cheapest to set up and the most common shape.
- **One repository, three self-contained projects.** Each with its own `package.json`, lockfile,
  Dockerfile, Compose stack, Makefile and `CLAUDE.md`; a root Makefile that only fans out.

The forcing consideration is what the acceptance suite is for. It is meant to be a black-box client:
it drives the API over HTTP and the UI through a browser, and knows nothing else about either. A
shared workspace makes that discipline a matter of resolve — one import from `backend/src` and the
suite is testing the implementation it is supposed to be independent of. Nothing would fail.

## Decision

We will keep one repository containing three self-contained projects, each owning its own build,
image, Compose stack and documentation. The root holds no logic: its `Makefile` fans out over
`PROJECTS := backend frontend acceptance-tests` and delegates every target to the project's own
`Makefile`.

Independence is structural, not aspirational. There is **no root `package.json`**, no workspace, and
no shared `node_modules`. A project cannot import from a sibling because there is no module
resolution path that reaches one. `frontend/` never resolves a path into `backend/`; it holds its own
copy of the API contract (ADR 13). The acceptance suite reaches the other two only over HTTP and
through a browser (ADR 14). Each project builds and runs if copied out of the repository on its own.

Orchestration lives in Docker Compose rather than in a process manager, one project per Compose
project name, all prefixed `nmk-`. That prefix is what lets `make ps` show every container across
every stack in one table.

The business justification is time to market on a submission with a deadline. One `make up` starts
everything; one `make run-guardrails` answers "will CI pass?". A reviewer clones one repository and
needs Docker and `make` — no Node version manager, no per-project install, no secrets. Three
repositories would have cost setup instructions that a reviewer has to follow before seeing anything
work.

## Consequences

Dependency versions drift between projects, and have: ESLint is 9.x in the backend and 10.x in the
other two, `@types/node` is 24 in two projects and 26 in the third. Nothing forces convergence and
nothing should — a shared version is a coupling, and these projects are meant to be independent. The
cost is real when a lint rule behaves differently in one project than another.

Some configuration is duplicated across the three: Prettier settings, TypeScript base options, the
Dockerfile shape. Deduplicating it would require a shared package, which would reintroduce the
coupling this decision exists to avoid. Duplication is the cheaper of the two.

Every project must supply the same target vocabulary — `setup`, `up`, `down`, `lint`, `format` — for
the root fan-out to work. Adding a project means implementing that vocabulary, and adding a check
means adding a target to every project it applies to.

Each subproject `Makefile` ends in a `%:` / `@:` catch-all, which is what makes `make npm <script>`
work. It also means a typo'd target inside a subproject **exits 0 and does nothing**:
`make backend/lnt` succeeds silently. Root-level typos error normally.

Adding a Compose project whose name is not prefixed `nmk-` makes it invisible to `make ps`.

Startup order between projects is the root `Makefile`'s to know, and `PROJECTS` encodes it: anything
that talks to another project comes after it. That is the one thing about their relationship the
root has to hold, and it is why `acceptance-tests` is last.

## Compliance

Manual, with two mechanical checks available:

- `find . -name package.json -maxdepth 2 -not -path '*/node_modules/*'` returns three files and no
  root one. A root `package.json` appearing is the signal that this decision has been reversed.
- `make ps` — a container missing from its output has a Compose project name that has lost the
  `nmk-` prefix.

The stronger enforcement is indirect: ADR 13's `make lint-api-contract` and ADR 5's
`make lint-architecture` both fail if a project starts reaching across a boundary.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-28 · Last modified: 2026-07-31

Reconstructed after the fact; the arrangement arrived whole in the initial commit.
