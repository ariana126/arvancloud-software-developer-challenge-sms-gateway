# Acceptance Tests

The executable specification for the SMS gateway: twenty-eight scenarios written in business
language, driving the system from outside exactly as a customer would.

Wired into the monorepo like its sibling projects — a `Makefile` speaking the shared target
vocabulary, a Docker Compose stack named `nmk-acceptance-tests`, and an entry in the root Makefile's
`PROJECTS` (last, since it depends on the other two being up).

Cucumber for the specifications, [Serenity/JS](https://serenity-js.org/) for the automation, and
Playwright for the browser.

## Two doors, and only two

The suite reaches the system through the **HTTP API a client would call** and the **page a person
would look at**. Nothing else: no importing code from the other projects, no database access, no
reading a component's source to find a selector.

That constraint is what makes these tests worth having. They know nothing about the implementation,
so they keep validating behaviour through a rewrite of it — and a scenario that passes is evidence
about the product rather than about the code that happens to be there today.

It has a sharp edge, deliberately: **a precondition that cannot be set up through one of those two
doors does not get set up.** Two things could not — a clean database between scenarios, and control
of the clock — and the answer was not to open a third door but to build them as endpoints the system
genuinely exposes, on a stack that exists for the purpose. See
[ADR 14](../docs/adr/0014-acceptance-suite-uses-two-public-doors.md).

## The specifications

Six feature files, twenty-eight examples.

| Feature | Examples | |
| --- | --- | --- |
| `specs/registration/sign-up.feature` | 17 | Sign-up, duplicate email, and three outlines for weak passwords, invalid emails and missing data |
| `specs/credit/increase-credit.feature` | 1 | Topping up an account |
| `specs/sms-sending/send-sms.feature` | 4 | A successful send; spending the balance to exactly zero; two simultaneous sends that cannot both spend the same credit; a send refused for insufficient credit |
| `specs/sms-sending/send-express-sms.feature` | 1 | The express delivery-time guarantee is shown to the customer |
| `specs/sms-sending/high-volume-senders.feature` | 3 | A light sender shares capacity; a heavy sender is given its own; one customer's volume does not reclassify another |
| `specs/reporting/view-sent-sms-report.feature` | 2 | Reading the report; not seeing another user's messages |

The three scenarios in `send-sms.feature` that concern credit map one-to-one onto the brief's
requirement that a customer can use their **entire** balance and that nothing is accepted once it is
exhausted — including when two requests arrive at the same instant. See the
[requirements map](../docs/requirements.md).

## Blended: some scenarios drive the browser, most drive the API

Six of the twenty-eight examples go through a real browser — the sign-up journey, the duplicate-email
rejection, the three send-SMS scenarios and the express send. The remaining twenty-two are black-box
HTTP against the API.

The split follows *BDD in Action* ch. 10 on when a UI test earns its cost: a scenario goes through
the browser when the risk being covered lives in the UI, and through HTTP otherwise.

**The feature files know nothing about any of this.** There are no `@ui` or `@api` tags to keep in
sync. Each step's **grammatical voice** decides which door it goes through:

- `Given Ariana already has an account` is passive — we care only *that* it is true, so it takes the
  API.
- `When she signs up` is active — we are demonstrating *how*, so it drives the browser.

Cucumber matches the two voices with different expressions, so the routing happens at the
step-definition level with nothing to configure. `CLAUDE.md` has the per-scenario table and the
reason for each row.

## How elements are found

By **accessible name** — an input by its visible `<label>`, a value by the `<dt>` beside it, a button
by its text. There are no `data-test` attributes anywhere in the frontend and none are needed:
`make lint-accessibility` already fails the build when a label goes missing, so the accessibility gate
doubles as the locator contract.

Where no accessible name exists the suite falls back to a structural selector, and those are
**ungated** — [ADR 15](../docs/adr/0015-locate-ui-elements-by-accessible-name.md) lists all six and
is explicit about which two are provably outside the gate's reach.

## Architecture

Three layers, with the dependency running one way.

```
specs/            Gherkin. The business's document — no automation detail.
step-definitions/ Glue. Translates a step into a Screenplay task or question.
screenplay/       Tasks, questions and abilities. What an actor can do and ask.
  └── ui/         Lean Page Objects — the only place a selector appears.
support/          Hooks, test data, isolation.
```

Step definitions never touch `screenplay/ui/` directly. Actors carry abilities — `CallAnApi`,
`BrowseTheWeb` — and a task reads like the sentence it automates.

## Isolation

Every scenario starts clean: the database is truncated, the clock is reset, and a fresh cast of
actors is created. Each actor gets its own browser context, so two actors in one scenario are two
genuinely separate sessions.

The hooks call the testing endpoints with raw `fetch` rather than through the suite's own Screenplay
abstractions — deliberately, so setup and teardown do not appear in the living documentation as
though they were behaviour a customer cares about.

## Commands

Runs in Docker via the Makefile. Prerequisites: Docker, Docker Compose, `make`, and **both test
stacks up** — the backend on 3001 and the frontend on 4201.

From the repository root, which brings up everything needed and then runs the suite:

```bash
make run-acceptance-tests          # test stacks up, then the suite
make render-living-documentation   # render the site from the last run
make open-living-documentation     # render it and open it in a browser
```

From this directory:

```bash
make up                  # start this container
make run                 # run the suite (assumes the test stacks are already up)
make sh                  # open a shell in the container
make npm <script>        # run any package.json script inside it
make help                # list all available make targets
```

Start the stacks on their own with `make -C ../backend test-up` and `make -C ../frontend test-up`.

## Living documentation

Every run renders a browsable site from the scenarios that actually executed — not a description of
the tests, but their results. It cannot drift from the code, because it *is* the code's behaviour.

The latest `main` is published at
**<https://ariana126.github.io/arvancloud-software-developer-challenge-sms-gateway/>**.

A failing UI step attaches a screenshot, which is why CI uploads the rendered site as an artifact on
every run, pass or fail: the job log can name the element, only the picture shows the page.

## Further reading

`CLAUDE.md` in this directory covers the per-scenario door table with its reasoning, the Screenplay
vocabulary and conventions, the assertion rules, the two kinds of waiting, and the gotchas. Read it
before adding a scenario.
