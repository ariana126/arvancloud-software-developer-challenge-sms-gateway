# 15. Locate UI Elements by Accessible Name, Not Test Attributes

## Status

Accepted — 2026-07-28 (`bb9ff6c`).

## Context

Six of the twenty-eight acceptance examples drive a real browser: the sign-up journey, the
duplicate-email rejection, the three send-SMS scenarios and the express send. The rest stay black-box
HTTP against the API.

That split is itself a decision, and it follows *BDD in Action*'s guidance on when a UI test earns
its cost — a scenario goes through the browser when the risk being covered lives in the UI, and
through HTTP otherwise. The feature files know nothing about it: each step's grammatical voice
decides which door it goes through, so there are no `@ui` / `@api` tags to keep in sync.

Whichever door a step uses, the browser ones need to find elements. The options:

- **`data-test` attributes.** The convention most suites use. Stable, explicit — and markup that
  exists only for tests, which nothing else validates, and which a developer can delete without
  understanding what it was for.
- **CSS classes and DOM structure.** No extra markup, and it breaks on every restyle.
- **IDs.** Stable if maintained, and they say nothing about whether the element is usable.
- **Accessible names** — the visible `<label>` of an input, the text of a button, the `<dt>` beside a
  value.

The last one has a property the others lack: **something else already has to be true for it to
work.** An input with no label is an accessibility defect before it is a locator problem.

## Decision

We will locate elements by their accessible name, and carry **no `data-test` attributes anywhere in
the front end**.

The markup contract that makes this possible is small and non-negotiable: a `<label for>` on every
input, a real `<button type="submit">`, no `div` click targets, and a `title` on every route for the
live region.

`make lint-accessibility` is what holds it. It runs axe's WCAG A/AA rules against every route in a
**real headless Chromium** — not jsdom, because axe grades rendered output and colour contrast is not
merely unchecked in jsdom but uncheckable. A missing label fails the build.

So the accessibility gate doubles as the locator contract, and the two reinforce each other: a change
that breaks the suite's locators usually fails the accessibility job first, with a better error
message.

The business justification is that this buys two things with one mechanism. The accessibility gate
would be worth running on its own — it is a legal and ethical baseline for a product customers log
into — and making it load-bearing for the test suite means it can never be quietly switched off as
"the slow job that always passes".

## Consequences

**The gate does not cover everything the suite depends on, and it is worth knowing exactly where it
stops.** Alongside the accessible names, the suite anchors on six structural selectors that nothing
gates:

| Selector | File |
| --- | --- |
| `form app-text-field` | `acceptance-tests/screenplay/ui/form.ts` |
| `form button` | `acceptance-tests/screenplay/ui/form.ts` |
| `form [role="alert"]` | `acceptance-tests/screenplay/ui/form.ts` |
| `.field__error` | `acceptance-tests/screenplay/ui/form.ts` |
| `dl div` | `acceptance-tests/screenplay/ui/profile-record.ts` |
| `app-site-header button\|a` | `acceptance-tests/screenplay/ui/site-header.ts` |

Two of those are provably outside the gate's reach. **The audit visits each route in its *initial*
state**, and `frontend/a11y/accessibility.spec.ts` says so outright — a form's *error* state is not
reachable by navigation, so nothing there grades it. Renaming the `field__error` class, dropping the
`app-text-field` wrapper, or flattening `<dl><div>` therefore breaks the acceptance suite **with no
check failing first**.

That is the honest limit. The convention is still right; the assumption that the gate protects all of
it is not.

Locating by label text means the suite is coupled to user-visible copy. Rewording a label breaks a
scenario — which is arguably correct, since the wording is what a user reads, but it is a real
maintenance cost and it makes internationalisation a larger change than it looks.

`lint-accessibility` is the one check that needs its subject **running**. It starts the front end
itself and drives Chromium at it, and it leaves the dev server up afterwards — `make down` when
finished. It also carries its own image (`Dockerfile.a11y`) because Chromium is large enough that no
other project should pay for it.

The route list the audit walks is the one manual step in an otherwise automatic gate. A new route not
added to that list is simply never graded.

The accessibility job uploads axe's report as a CI artifact on every run, pass or fail, because the
job log names the offending element while the report shows it.

## Compliance

`make lint-accessibility` — axe WCAG A/AA over every listed route, in a real browser, as its own CI
job.

For the six structural selectors above: **nothing**. Named here so the gap is known rather than
assumed away. The mitigation available today is that the acceptance suite itself fails when they
break — later than the a11y job would, and with a worse error, but not silently.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-28 · Last modified: 2026-07-31

Reconstructed after the fact. Related: ADR 14 (the doors this governs the second of).
