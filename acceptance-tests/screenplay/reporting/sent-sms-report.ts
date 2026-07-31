import {
  AnswersQuestions,
  Duration,
  PerformsActivities,
  Question,
  QuestionAdapter,
  Task,
} from '@serenity-js/core';
import { contain, Ensure, equals, not } from '@serenity-js/assertions';
import { GetRequest, LastResponse, Send } from '@serenity-js/rest';
import {
  LogIn,
  TheirBearerToken,
  TheirOwnCredentials,
} from '../authentication/log-in';
import { messageFrom } from '../sms-sending/sms-details';

/**
 * One entry in the report, as the API returns it.
 *
 * The response is a **bare array**, not an object with a `data` or `items` wrapper — hence
 * `LastResponse.body<SentSmsReportEntry[]>()` below rather than a projection through a field.
 *
 * Every field the endpoint sends is declared, but only two are ever read. That is deliberate: the
 * scenarios speak about who a message went to and whose it was, and nothing else. Asserting the
 * `status`, the `cost` or the ordering would document rules this feature file does not state, and
 * would break the automation the day one of them legitimately changed.
 */
interface SentSmsReportEntry {
  id: string;
  recipient: string;
  message: string;
  status: string;
  serviceLevel: string;
  cost: number;
  sentAt: string;
}

/**
 * Reading back the SMS an actor has sent.
 *
 * One route, and it is the API. There is no report screen at all (`frontend`'s routes are the
 * identity pages and `/send-sms`), and nothing in the feature file is about what a screen shows:
 * both scenarios are passive and data-shaped, and the second one's subject is per-user isolation,
 * which is an authorisation rule rather than a rendering one. `viaApi` even so, following
 * `AddCredit.viaApiUsing` — the door belongs in the method name so that the day a report page
 * ships, `.using()` sits beside it and the feature file never notices.
 *
 * Contract: `GET sms`, bearer-authenticated, `200` with an array of the *authenticated user's*
 * sends, newest first. The scoping is the whole point of the second scenario, and it is the
 * server's job — this task sends no filter and must not start sending one.
 */
export class ViewTheirSentSmsReport {
  static viaApi = (): Task =>
    Task.where(
      '#actor views their sent SMS report (via the API)',
      // No browser on this door to carry a session, so the actor logs in immediately beforehand
      // and reads the token off that response — as in the credit and pricing tasks.
      LogIn.viaApiUsing(TheirOwnCredentials()),
      Send.a(
        GetRequest.to('sms').using({
          headers: { Authorization: TheirBearerToken() },
        }),
      ),
      // Checked here, in the `When`, rather than left to the `Then`. The assertions below read the
      // body as an array; if the endpoint is missing or refuses, they would fail on the shape of a
      // problem-detail object and say something unrelated to what went wrong. This makes it
      // "expected 404 to equal 200" instead — the same reasoning as `LookUpTheCostOfOneSms`.
      Ensure.that(LastResponse.status(), equals(200)),
    );
}

/** The report itself: whatever the last `GET sms` returned. No request, so it is safe anywhere. */
export const TheSentSmsReport = (): QuestionAdapter<SentSmsReportEntry[]> =>
  LastResponse.body<SentSmsReportEntry[]>();

/**
 * Waits until a message the actor sent has actually reached the carrier.
 *
 * **Why a wait is needed at all.** `POST sms` answers `201` once the send is charged, recorded and
 * published to its dispatch lane — accepted, in other words, not delivered. A worker consuming
 * that lane hands it to the carrier a moment later and only then does it become `SENT`, which is
 * the status the report filters on. So there is a real, if brief, window in which a send has
 * succeeded and the report is legitimately empty.
 *
 * This belongs to a `Given`, not to a `Then`. "Ariana **has sent** an SMS" is a completed
 * precondition, and a precondition is not established until the system has finished acting on it —
 * the same standard `AddCredit` holds itself to by checking its own `204`. Putting the wait here
 * rather than in the assertions is what keeps every `Then` in this file a plain, immediate claim
 * about a report that is already settled, and keeps the feature files free of any hint that
 * delivery is asynchronous.
 *
 * **A hand-written `Task` subclass rather than `Wait.until`,** because the poll has to *re-issue*
 * the request each time. `Wait.until` re-answers a question, and every question here reads
 * `LastResponse` — polling one would loop on the same stale body forever. Only a `Task` gets an
 * actor that can both `attemptsTo` and `answer`; `Question.about` and `Interaction.where` are
 * handed narrower actors with no `attemptsTo` at all.
 *
 * It logs in on each poll rather than caching a token, because `TheirBearerToken` reads the token
 * off the last login response and any request in between replaces it. Two requests per poll is a
 * fair price for not putting a token in the shared notepad.
 */
export const EnsureTheirSmsHasReachedTheCarrier = (recipient: string): Task =>
  new WaitUntilTheirSmsHasReachedTheCarrier(recipient);

const howLongToWaitForDelivery = Duration.ofSeconds(20);
const howOftenToCheckForDelivery = Duration.ofMilliseconds(250);

class WaitUntilTheirSmsHasReachedTheCarrier extends Task {
  constructor(private readonly recipient: string) {
    super(
      `#actor waits until their SMS to ${recipient} has reached the carrier`,
    );
  }

  async performAs(actor: PerformsActivities & AnswersQuestions): Promise<void> {
    const giveUpAt = Date.now() + howLongToWaitForDelivery.inMilliseconds();

    for (;;) {
      await actor.attemptsTo(
        LogIn.viaApiUsing(TheirOwnCredentials()),
        Send.a(
          GetRequest.to('sms').using({
            headers: { Authorization: TheirBearerToken() },
          }),
        ),
      );

      const report = await actor.answer(TheSentSmsReport());
      if (report.some((entry) => entry.recipient === this.recipient)) {
        return;
      }

      if (Date.now() >= giveUpAt) {
        throw new Error(
          `Expected the SMS to ${this.recipient} to have reached the carrier within ` +
            `${howLongToWaitForDelivery.toString()}, but the sent SMS report still does not list it. ` +
            `Is the dispatch worker for its lane running?`,
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, howOftenToCheckForDelivery.inMilliseconds()),
      );
    }
  }
}

const TheRecipientsInTheirReport = (): QuestionAdapter<string[]> =>
  Question.about('the recipients in their sent SMS report', async (actor) =>
    (await actor.answer(TheSentSmsReport())).map((entry) => entry.recipient),
  );

const TheMessagesInTheirReport = (): QuestionAdapter<string[]> =>
  Question.about('the messages in their sent SMS report', async (actor) =>
    (await actor.answer(TheSentSmsReport())).map((entry) => entry.message),
  );

/**
 * The scenario names the recipient, so the assertion takes it rather than deriving it: "the SMS
 * sent to 09121234567 appears in his report" is a claim about that number and no other fact.
 */
export const EnsureReportIncludesSmsTo = (recipient: string): Task =>
  Task.where(
    `#actor ensures their report includes the SMS sent to ${recipient}`,
    Ensure.that(TheRecipientsInTheirReport(), contain(recipient)),
  );

/**
 * The other half of the isolation rule, and the reason it takes a *name* rather than a number.
 *
 * The final `Then` does not repeat Fateme's recipient, and notepads are per-actor — Ariana cannot
 * read what Fateme wrote down. The one fact about Fateme's SMS that Ariana can work out from the
 * bare name is its message body, `Hello from Fateme`, derived exactly the way `signUpDetailsOf`
 * lets one actor work out another's email. That is what `messageFrom` is for, and this is its
 * call site — it rests on the report carrying `message` per entry.
 *
 * Asserted over the *messages*, not over the report being empty. Ariana's report happens to be
 * empty in this scenario, but "empty" is a stronger claim than the Gherkin makes and it would
 * stop being true the moment someone gave her a send of her own.
 */
export const EnsureReportExcludesAnySmsFrom = (actorName: string): Task =>
  Task.where(
    `#actor ensures their report includes no SMS sent by ${actorName}`,
    Ensure.that(
      TheMessagesInTheirReport(),
      not(contain(messageFrom(actorName))),
    ),
  );
