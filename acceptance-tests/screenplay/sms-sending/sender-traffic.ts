import {
  AnswersQuestions,
  notes,
  PerformsActivities,
  QuestionAdapter,
  Task,
} from '@serenity-js/core';
import { Ensure, equals } from '@serenity-js/assertions';
import { GetRequest, LastResponse, Send } from '@serenity-js/rest';
import {
  LogIn,
  TheirBearerToken,
  TheirOwnCredentials,
} from '../authentication/log-in';
import { AccountNotes } from '../common/notes';
import { AddCredit } from '../credit/account-credit';
import { SendAnSms } from './send-sms';
import { smsDetailsOf } from './sms-details';
import { LookUpTheCostOfOneSms, TheCostOfOneSms } from './sms-pricing';

/**
 * What `GET sms/traffic` answers with.
 *
 * Note what is **not** here: no lane, no topic, no worker. The API publishes the classification
 * and the numbers behind it and keeps the mechanism to itself — so this suite could not couple
 * itself to the broker through this door even if it wanted to.
 */
interface SenderTrafficBody {
  tier: string;
  sendsInWindow: number;
  windowInSeconds: number;
  bulkThreshold: number;
}

/**
 * Somebody to send to. The feature file names no recipient — its scenarios are about *how much*
 * a customer sends, not who to — so the number is invented here rather than in the Gherkin.
 */
const SOMEBODY = '09121234567';

/**
 * The two classifications, in the words the scenarios use rather than the codes the API sends.
 *
 * The translation lives here for the same reason `theSendSmsRequestBody` translates service
 * levels at the edge: `SHARED` and `BULK` are wire vocabulary, and a feature file saying "BULK"
 * would be describing an enum rather than a business rule.
 */
const theTierBehind: Record<string, string> = {
  'shares capacity with other senders': 'SHARED',
  'is given capacity of its own': 'BULK',
};

/**
 * Asks the system how it currently classifies the actor's traffic.
 *
 * Contract: `GET sms/traffic`, bearer-authenticated, `200 { tier, sendsInWindow, windowInSeconds,
 * bulkThreshold }`. The authenticated user is the only input — there is no identifier a caller
 * could supply to ask about somebody else, which is what makes the third scenario's isolation
 * claim meaningful rather than a matter of passing the right parameter.
 *
 * The status is checked in the `When`, as in `ViewTheirSentSmsReport` and for the same reason: a
 * missing endpoint should fail as "expected 404 to equal 200" rather than as an assertion about
 * `undefined` two steps later.
 */
export class CheckHowTheirTrafficIsClassified {
  static viaApi = (): Task =>
    Task.where(
      '#actor checks how their traffic is classified (via the API)',
      LogIn.viaApiUsing(TheirOwnCredentials()),
      Send.a(
        GetRequest.to('sms/traffic').using({
          headers: { Authorization: TheirBearerToken() },
        }),
      ),
      Ensure.that(LastResponse.status(), equals(200)),
    );
}

/** A read of whatever the last `GET sms/traffic` returned. No request, so it is safe anywhere. */
const TheirTraffic = (): QuestionAdapter<SenderTrafficBody> =>
  LastResponse.body<SenderTrafficBody>();

export const EnsureTheirTrafficIs = (classification: string): Task =>
  Task.where(
    `#actor ensures their traffic ${classification}`,
    Ensure.that(TheirTraffic().tier, equals(tierBehindOrFail(classification))),
  );

function tierBehindOrFail(classification: string): string {
  const tier = theTierBehind[classification];
  if (!tier) {
    throw new Error(
      `No traffic tier is mapped to "${classification}". Known: ${Object.keys(theTierBehind).join(', ')}.`,
    );
  }
  return tier;
}

/**
 * Reads the high-volume threshold and writes it to the notepad.
 *
 * A **task** that fetches and a question that only reads, exactly as `LookUpTheCostOfOneSms` is
 * and for the identical reason: a question that issued this `GET` would replace the
 * `LastResponse` whichever assertion called it was reading.
 */
export const LookUpTheHighVolumeThreshold = (): Task =>
  Task.where(
    '#actor looks up the high-volume threshold',
    CheckHowTheirTrafficIsClassified.viaApi(),
    notes<AccountNotes>().set(
      'highVolumeThreshold',
      TheirTraffic().bulkThreshold,
    ),
  );

/** A notepad read. Performs no request, so it is safe anywhere — see above. */
const TheHighVolumeThreshold = (): QuestionAdapter<number> =>
  notes<AccountNotes>().get('highVolumeThreshold');

/**
 * The precondition behind "{actor} has sent more SMS than the high-volume threshold".
 *
 * **The threshold is read from the API, never hardcoded.** It is a capacity decision an operator
 * tunes, and the test stack deliberately runs it far below what production would — so a number
 * written into this suite would be a copy of a configuration value it has no business knowing.
 * `GET sms/traffic` publishes the threshold so that a customer can see how close it is, and that
 * same field is what makes this precondition self-adjusting.
 */
export const HaveSentMoreSmsThanTheHighVolumeThreshold = (): Task =>
  Task.where(
    '#actor has sent more SMS than the high-volume threshold',
    LookUpTheHighVolumeThreshold(),
    LookUpTheCostOfOneSms(),
    SendEnoughSmsToCrossTheThreshold(),
  );

/**
 * A hand-written `Task` subclass rather than `Task.where`, because **how many sends** is not known
 * until the threshold has been read, and `Task.where` takes its activities as a list built before
 * any of them run. A `Task` is also the only construct handed an actor that can both `attemptsTo`
 * and `answer` — `Question.about` and `Interaction.where` get narrower ones with no `attemptsTo`.
 *
 * One *more* than the threshold, because the classification is strictly greater than: a customer
 * sitting exactly on its allowance is still part of the long tail, so stopping at the threshold
 * would establish the opposite of this precondition.
 *
 * The funding is worked out the same way, from the price the system published — the actor is
 * topped up for exactly the sends it is about to make, so nothing here invents a balance the
 * Gherkin declined to state.
 *
 * The sends are sequential and deliberately **not** waited on for delivery: the traffic count is
 * incremented in the same transaction that charges the send, so the classification is already
 * correct when the last `201` comes back. This precondition is about how much was *sent*, not
 * about what has since been delivered — which is why, unlike `HaveAlreadySentAnSms`, it needs no
 * wait.
 */
const SendEnoughSmsToCrossTheThreshold = (): Task =>
  new SendEnoughSmsToCrossTheHighVolumeThreshold();

class SendEnoughSmsToCrossTheHighVolumeThreshold extends Task {
  constructor() {
    super('#actor sends enough SMS to cross the high-volume threshold');
  }

  async performAs(
    actor: PerformsActivities & AnswersQuestions & { name: string },
  ): Promise<void> {
    const threshold = await actor.answer(TheHighVolumeThreshold());
    const costPerSms = await actor.answer(TheCostOfOneSms());
    const sends = threshold + 1;

    await actor.attemptsTo(AddCredit.viaApiUsing(sends * costPerSms));

    for (let sent = 0; sent < sends; sent++) {
      await actor.attemptsTo(
        SendAnSms.viaApiUsing(smsDetailsOf(actor.name, SOMEBODY)),
      );
    }
  }
}
