import {
  Interaction,
  notes,
  Question,
  QuestionAdapter,
  TakeNotes,
  Task,
} from '@serenity-js/core';
import { Ensure, equals } from '@serenity-js/assertions';
import { CallAnApi } from '@serenity-js/rest';
import {
  LogIn,
  TheirBearerToken,
  TheirOwnCredentials,
} from '../authentication/log-in';
import { AccountNotes } from '../common/notes';
import { SmsDetails } from './sms-details';

/**
 * Two sends fired at the same moment, so that the system has to decide which of them may spend a
 * balance that covers only one.
 *
 * **This goes through the API**, where the other send-SMS scenarios drive the browser, and the
 * reason is not a preference: a person cannot submit one form twice simultaneously, so there is no
 * journey here to demonstrate. The rule being documented is about the system rather than the
 * screen — what a sender is *told* is already covered by the rejection scenario next to it.
 */
export class SendTwoSmsAtTheSameMoment {
  static viaApiUsing = (details: SmsDetails): Task =>
    Task.where(
      `#actor sends two SMS to ${details.recipient} at the same moment`,
      notes<AccountNotes>().set('sms', details),
      // Once, before the race: logging in twice would be two more requests to interleave with the
      // two under test, and the token is the same either way.
      LogIn.viaApiUsing(TheirOwnCredentials()),
      RecordTheOutcomesOfTwoSimultaneousSends(details),
    );
}

/**
 * Fires both requests without waiting for either, and remembers what each answered.
 *
 * It cannot use `Send.a(...)`: that is sequential by construction, and each call overwrites
 * `LastResponse` — so by the time an assertion ran, the first send's answer would be gone and the
 * two would never have been in flight together. Reaching for the ability directly is what buys
 * genuine simultaneity, and the outcomes go on the notepad because there is no single "last
 * response" to speak of any more.
 *
 * Both promises are awaited together rather than in sequence. `Promise.all` would reject as soon as
 * the losing send did, which is the one outcome this task exists to observe.
 */
const RecordTheOutcomesOfTwoSimultaneousSends = (
  details: SmsDetails,
): Interaction =>
  Interaction.where(
    `#actor fires two sends to ${details.recipient} at once`,
    async (actor) => {
      const api = CallAnApi.as(actor);
      const authorization = await actor.answer(TheirBearerToken());

      const send = async (): Promise<number> => {
        const response = await api.request({
          method: 'POST',
          url: 'sms',
          data: { recipient: details.recipient, message: details.message },
          headers: { Authorization: authorization },
          // Without this, axios rejects on the 402 and the losing send's status would arrive as an
          // exception rather than as an answer. A rejection is exactly what we expect one of them
          // to be, so it has to be readable as data.
          validateStatus: () => true,
        });
        return response.status;
      };

      const outcomes = await Promise.all([send(), send()]);

      // The notepad is reached through its ability rather than through
      // `notes().set(...)`: inside an `Interaction` the actor can use abilities and answer
      // questions, but cannot perform further activities.
      TakeNotes.as<TakeNotes<AccountNotes>>(actor).notepad.set(
        'sendOutcomes',
        outcomes,
      );
    },
  );

const TheSendOutcomes = (): QuestionAdapter<number[]> =>
  notes<AccountNotes>().get('sendOutcomes');

const HowManySendsAnswered = (status: number): QuestionAdapter<number> =>
  Question.about(`how many sends answered ${status}`, async (actor) => {
    const outcomes = await actor.answer(TheSendOutcomes());
    return outcomes.filter((outcome) => outcome === status).length;
  });

/**
 * Exactly one, not at least one. "At least" would pass on the failure this scenario exists to
 * catch — both sends succeeding against a balance that covers one of them.
 */
export const EnsureExactlyOneSendSucceeded = (): Task =>
  Task.where(
    '#actor ensures exactly one of the two sends succeeded',
    Ensure.that(HowManySendsAnswered(201), equals(1)),
  );

/**
 * Asserted as a count for the same reason, and as *insufficient credit* specifically: the loser
 * must be told the honest thing — there was not enough credit — rather than being handed a
 * conflict or a server error to puzzle over.
 */
export const EnsureTheOtherSendWasRejectedForInsufficientCredit = (): Task =>
  Task.where(
    '#actor ensures the other send was rejected for insufficient credit',
    Ensure.that(HowManySendsAnswered(402), equals(1)),
  );
