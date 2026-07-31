# 1. Record Architecture Decisions in ADRs

## Status

Accepted — 2026-07-31.

## Context

Every architectural decision in this repository already has a written rationale. It lives as
narrative prose inside seven `CLAUDE.md` files, and that prose is unusually good: it explains why
the workers are separate containers, why a wallet is never written as a whole state, why the
accessibility gate doubles as a locator contract.

What it does not do is behave like a decision record. A `CLAUDE.md` section has no identity to cite,
no status, no date, no list of alternatives that were rejected, and no way to say that a decision was
later replaced. A reader who wants to know *what was decided and what it cost* has to read a
465-line file end to end and infer it.

That gap is not academic here. Three commits landed on 2026-07-31, and each one revised an earlier
decision:

- the transactional outbox replaced a `charge → deliver → save` arrangement whose failure mode the
  documentation had explicitly described and accepted;
- `QUEUED` was introduced because the arrival of a broker made "a successful publish means delivered"
  false;
- `PrismaSmsMessageRepository`'s unconditional whole-state upsert was correct, was documented as
  correct, and then stopped being correct the moment a second writer appeared — silently, with no
  code change. It cost 39 of 45 delivered messages, permanently reported as undelivered.

The third is the one that makes the case. **The premise that made the old code safe was written down,
and it stopped being true without the code changing.** Prose interleaved with instructions has no
place to record that. A decision record does.

The alternatives considered were: keep everything in `CLAUDE.md` and accept the gap; adopt a
lighter three-section template (Context / Decision / Consequences); or put the records in an external
wiki, which *Fundamentals of Software Architecture* recommends for larger organisations so that
integration and enterprise decisions have a home and everyone has access.

## Decision

We will record architecturally significant decisions as ADRs in `docs/adr/`, one file per decision,
using the seven-section template below.

The template is Michael Nygard's five sections plus the two Richards and Ford add:

| Section | Contents |
| --- | --- |
| **Title** | Sequentially numbered, descriptive enough to remove ambiguity |
| **Status** | `Proposed`, `Accepted`, or `Superseded`, with the supersession trail |
| **Context** | The forces at play, and the alternatives that were rejected |
| **Decision** | The decision in commanding voice, with a technical *and* a business justification |
| **Consequences** | The impact, good and bad, including the trade-off analysis |
| **Compliance** | How the decision is measured and governed |
| **Notes** | Author and dates |

Four rules govern the writing:

1. **Commanding voice in Decision.** "We will use separate topics per lane", never "separate topics
   seem better". A reader must be able to tell that a decision was made, not that an opinion was
   held.
2. **A business justification is mandatory.** Cost, time to market, user satisfaction, or strategic
   positioning. If a decision has no business justification, that is a signal it should not be a
   decision — it is guidance, and it belongs in `CLAUDE.md`.
3. **Compliance names a real gate.** This repository enforces most of its structure with fitness
   functions, so most ADRs can name the exact command that fails when the decision is violated. Where
   no automation exists, the section says so plainly. **An honest "no automated gate" is worth more
   than an invented one** — ADR 12 is the case in point, and writing it is what surfaced the gap.
4. **Superseding is bidirectional.** The old ADR gets `Superseded by N`; the new one gets
   `supersedes M`. Never edit an accepted decision's Decision section in place. The trail is what
   stops a settled debate from restarting.

**ADRs own *why*; `CLAUDE.md` files own *how*.** That is the division of labour, and it is why no
prose was deleted when this directory was added. `CLAUDE.md` remains the operational guide for
anyone — human or agent — working inside a project: commands, conventions, traps, where files go.
The ADR is where the reasoning behind a constraint is argued, dated, and left available to be
overturned. Each `CLAUDE.md` section that discusses a decision carries one pointer line to the ADR
that owns it.

The records live in this repository rather than an external wiki. Richards and Ford caution against
that for larger organisations, on the grounds that not everyone who needs a decision has repository
access and that integration decisions have context outside any one application. Neither applies: this
is a single self-contained submission, and keeping the records beside the code means they are
reviewed in the same pull request as the change they justify.

The business justification is reviewability. This repository is a hiring-task submission, and a
reviewer's scarcest resource is time. Fifteen accepted decisions and two documented deferrals, each
readable in two minutes, communicate the engineering judgment behind the code far faster than the
code does — and record the two things a reviewer would otherwise have to guess at: what was
considered and rejected, and what was knowingly left undone.

## Consequences

These ADRs were written **retrospectively**, after the decisions they record. That is the honest
framing and it has a cost: a retrospective ADR is reconstructed reasoning, and reconstruction is
kinder to the author than the original deliberation was. Where the record is a reconstruction rather
than a contemporaneous note, the ADR says so.

Writing them was not merely transcription. Forcing every decision through a Compliance section
surfaced a real gap that the prose had obscured — the SQL half of ADR 12's double enforcement has no
automated test at all, which is exactly the half whose absence caused the incident. That is the
process paying for itself before the directory was even committed.

There are now two places a decision can be described, and they can drift. The pointer lines are the
mitigation, and the division above is the rule: if an edit to a `CLAUDE.md` file changes *why*
something is done rather than *how*, it belongs in an ADR.

Seventeen files is more documentation than a system this size would normally carry. That is a
deliberate consequence of the submission's purpose, not a recommendation to keep the ratio as the
system grows.

## Compliance

Manual. A change that alters structure, an architecture characteristic, a dependency, an interface,
or a construction technique — Nygard's five criteria — should arrive with an ADR, or amend one.

Two checks are cheap enough to run by hand and are listed here so they are not forgotten: every ADR
referenced by `docs/adr/README.md` exists, and every ADR in the directory appears in that index.

No CI job enforces any of this, and one is deliberately not proposed. A gate that fails a build for a
missing document trains people to write empty documents.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-31 · Last modified: 2026-07-31

Template and terminology follow *Fundamentals of Software Architecture*, 2nd edition (Richards &
Ford), chapter 21, and Michael Nygard's original 2011 formulation.
