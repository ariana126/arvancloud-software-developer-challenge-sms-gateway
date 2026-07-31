# 3. The Makefile Is the Only Build Interface; CI Runs One Job Per Target

## Status

Accepted — 2026-07-28 (`bb9ff6c`).

## Context

The project has eight automated checks: formatting, linting, layer boundaries, OpenAPI drift, API
contract drift, accessibility, unit tests, acceptance tests. Each needs a container, a database, a
browser, or some combination.

The usual arrangement is for the CI workflow to describe how to run them — set up Node, install
dependencies, `npm ci`, `npm run lint` — and for developers to run something similar by hand
locally. Two descriptions of the same work, kept in step by discipline.

That arrangement fails in a predictable way: the checks pass locally and fail in CI, or the reverse,
because the two descriptions have drifted. The failure is worst for exactly the checks that are
hardest to reproduce — the ones needing a database, a broker, or a real browser.

The alternatives were a CI workflow describing the steps directly (rejected: two sources of truth);
a shell script per check, invoked by both (workable, but a `Makefile` already does this and gives
dependency ordering for free); or one CI job running everything in sequence (rejected: the failure
reads as one red X, and a reviewer must open the log to learn which check broke).

## Decision

We will make the `Makefile` the single source of truth for every check, and give each check its own
CI job that is a checkout plus one root target.

No command is ever inlined into `.github/workflows/ci.yml`. Every job is:

```yaml
- uses: actions/checkout@v4
- run: make lint-architecture
```

That is the whole job. Eight of them, running in parallel, one per check. What CI enforces is
therefore exactly what runs locally, because it is literally the same command.

Three properties follow, and each is load-bearing:

**No setup step, no Node installation, no secrets.** Every target builds its own container and
creates its own `.env` from the committed `.env.example` — `setup` is a prerequisite of `up`, `lint`,
`format`, `run-unit-tests` and the rest. The examples hold working local defaults, which is what
makes a secretless CI possible.

**A failure names itself.** A red `lint-swagger` job says what broke without anyone opening a log.
One sequential job would not.

**A new gate means a new root target, a job that calls it, and a line in `run-guardrails`** — in that
order, and never a command in the workflow.

`make run-guardrails` is the local mirror: the same eight checks, sequentially, cheapest first, so it
stops at the first failure. Its order is deliberately *not* CI's — `lint-api-contract` runs first
because it is a bare `cmp` needing no container, and the two checks that need something running go
last. `make fix-violations` is its writing counterpart, applying every automatic fix the checks would
demand. No CI job calls `fix-violations`, and none should: CI only ever runs read-only checks.

The business justification is the cost of a failed CI run. A round trip through GitHub to discover a
formatting error is minutes of a developer's attention and a wasted runner; `make run-guardrails`
finds it locally with one command and no ambiguity about whether the environments match.

## Consequences

Each CI job cold-builds its own image, because a fresh runner has no Docker layer cache. Eight jobs
therefore do redundant build work, and the wall-clock time of the slowest job is the wall-clock time
of CI. That is the price of parallel jobs that name their own failure, and it is paid knowingly.

**CI does not run on every change.** Both the `pull_request` and `push` triggers carry the same
`paths-ignore`:

```yaml
paths-ignore:
  - '**/*.md'
  - '.claude/**'
  - '**/.claude/**'
```

That is a wider net than "docs". It covers every `CLAUDE.md`, both READMEs, **and this directory** —
but also `.claude/settings.json` and the two executable hook scripts in `.claude/hooks/`. **Change a
hook and nothing verifies it.** `workflow_dispatch` carries no filter and is the escape hatch.

If branch protection is ever configured, note that `pull_request` with `paths-ignore` makes GitHub
report skipped jobs as *not run* rather than as skipped-successes — so a docs-only pull request would
sit unmergeable behind any of the eight marked as required.

A `concurrency` group of `ci-${{ github.ref }}` with `cancel-in-progress` means a new push to a
branch cancels the run it supersedes.

Make's own semantics leak into the interface. Reaching a project's target uses a slash —
`make backend/logs` — because `make backend up` would read `up` as a second root goal and start every
stack twice. And `make help` greps for targets carrying a `## ` comment, so **a target without one is
invisible**.

## Compliance

Read `.github/workflows/ci.yml`: every `run:` step must be `make <target>` and nothing else.
`grep -E '^\s+- run:' .github/workflows/ci.yml` should show only `make` invocations. A step that
inlines `npm`, `docker`, or a shell pipeline is this decision being violated.

`make run-guardrails` must list every target that CI runs as a job. The two lists are compared by
hand; they are eight lines each.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-28 · Last modified: 2026-07-31

Reconstructed after the fact. `make run-guardrails` and `make fix-violations` were added later than
the workflow itself, as the check list grew past the point where anyone could remember it.
