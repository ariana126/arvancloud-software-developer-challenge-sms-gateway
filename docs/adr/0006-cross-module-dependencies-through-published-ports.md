# 6. Cross-Module Dependencies Go Through a Published Port Surface

## Status

Accepted — 2026-07-29 (`49fff40`).

## Context

ADR 5 established that modules may not import each other. Sending an SMS broke that rule on the first
day it was needed: a send must charge the sender's credit, and credit belongs to a different module.

`SendSmsHandler` needs to debit a wallet inside the same transaction that records the message
(ADR 8). The options:

- **Duplicate the balance.** Keep a copy of credit inside `sms`. Two sources of truth for money, kept
  in step by hope. Rejected immediately.
- **Talk over HTTP.** Have `sms` call `POST /api/credit/...`. This is an in-process feature calling
  itself over the network — it gives up the shared transaction, which is the one thing the send
  actually needs, and buys an architecture quantum boundary nothing here wants.
- **Relax the rule.** Let `sms` import from `credit` freely. The rule then protects nothing; module
  isolation becomes a naming convention.
- **Publish a narrow port.** Nominate one directory per module as its public surface and forbid
  everything else.

The last one is the bounded-context question in miniature: not *may these modules talk*, but *what
exactly may one of them see*.

## Decision

We will treat each module's `domain/service/` directory as its **published port surface** — the only
thing another module may import — and keep everything else module-private.

`sms` depends on `credit` through `CreditLedger`, an abstract class in `credit/domain/service/`. It
never sees `Wallet`, `Money`, `Amount`, the repository, the handlers or the controllers.
`send-sms.handler.ts` imports exactly two things across the boundary: `CreditLedger` and
`InsufficientCredit`.

That second import is the part worth explaining. **`InsufficientCredit` lives in
`credit/domain/service/`, not in a module-private `credit/domain/exception/`** — because a caller in
another module has to be able to name the type in order to react to it. An exception a port can throw
is part of that port's contract, so it belongs on the seam. Putting it anywhere else would force
`sms` either to catch a type it may not import, or to branch on a string.

The port is bound with `@Global()` on the owning module and exported. **`sms.module.ts` must not
import `credit.module.ts`** — that would be infrastructure reaching into infrastructure, which
ADR 5's rule still forbids and which dependency-cruiser still fails.

The rule is written as a carve-out in the `modules-isolated` rule: a `to.pathNot` that permits
`domain/service` and the module's own path, everything else forbidden.

The business justification is that a narrow port is the cheapest of the four options *and* the one
that keeps the shared transaction. Duplicating the balance risks giving away messages; HTTP costs a
transaction the money depends on. This costs one abstract class.

## Consequences

The seam is narrow enough to be inconvenient on purpose. Anything `sms` wants from `credit` that is
not on `CreditLedger` requires a deliberate widening of the port — visible in a diff, in the module
that owns the data.

The `@Global()` binding means the provider is available everywhere, not only to the module that
declared the need. The linter, not the DI container, is what keeps other modules from reaching for
it.

**Two mechanics in how the carve-out is written, both easy to break by tidying.** Its `to.pathNot` is
an **array**, and dependency-cruiser joins an array to a single string with a naked `|` during
rule-set normalisation — *before* the `$1` back-reference to the `from` group is substituted. The
back-reference therefore survives the array (verified against `dependency-cruiser@18.1.0`). And
because the join wraps nothing in `(?:…)`, **every alternative must anchor itself with `^`**. Losing
either detail silently widens or breaks the rule.

If a third module ever needs credit, or `sms` grows a second consumer, this stays correct without
change — which is the property that made it worth a rule rather than an exemption.

The alternative not taken remains available: if `credit` ever needs to scale or deploy separately,
the port is exactly the seam an HTTP adapter would slot into, and no caller would change.

## Compliance

`make lint-architecture` — the `modules-isolated` rule and its carve-out.

This one is better than a rule that merely passes: it is **exercised for real**.
`sms/application/commands/send-sms/send-sms.handler.ts` imports `CreditLedger` and
`InsufficientCredit` from `@credit/domain/service/*`, so a passing `make lint-architecture`
demonstrates that the permitted path works, not just that no forbidden path is taken. A carve-out
nothing uses is a carve-out nobody notices breaking.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-29 · Last modified: 2026-07-31

Reconstructed after the fact. The rule and its carve-out arrived together with the send-SMS feature,
which is the case that forced it.
