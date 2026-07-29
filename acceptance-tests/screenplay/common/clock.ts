import { Answerable, Question, Task } from '@serenity-js/core';
import { Ensure, equals } from '@serenity-js/assertions';
import { LastResponse, PostRequest, Send } from '@serenity-js/rest';

/**
 * The instant a scenario freezes time at when it needs to reason about time at all.
 *
 * The point of naming it here is that the expectation is then **derived from a value this suite
 * chose**, rather than guessed at whatever the backend happens to hold. It is deliberately *not*
 * the backend's own default reset instant: if a freeze ever silently fails to take, an assertion
 * anchored on this value goes red instead of passing by coincidence.
 */
export const theMomentScenariosFreezeTimeAt = '2026-01-01T09:00:00.000Z';

/**
 * Freeze the backend clock at a given instant. Everything time-derived from then
 * on — JWT `iat`, token expiry, `registeredAt` — is stamped from this value until
 * it is changed again.
 */
export const FreezeTimeAt = (instant: Answerable<Date | string>): Task =>
  Task.where(
    '#actor freezes time',
    Send.a(
      PostRequest.to('testing/clock').with(
        Question.about('the instant to freeze time at', async (actor) => {
          const value = await actor.answer(instant);
          return { now: value instanceof Date ? value.toISOString() : value };
        }),
      ),
    ),
    // `Send.a()` asserts no status of its own, so without this a freeze that never took — a typo'd
    // route, or the endpoint missing because the suite is pointed at the dev stack — would pass
    // here and resurface as a baffling assertion failure much later. Same reasoning as `AddCredit`.
    // `LetTimePass` should gain the same check when it acquires a call site.
    Ensure.that(LastResponse.status(), equals(204)),
  );

/**
 * Advance the backend clock forward by a number of milliseconds from its current
 * frozen instant — e.g. to move past a token's expiry without freezing at a
 * magic timestamp.
 */
export const LetTimePass = (milliseconds: Answerable<number>): Task =>
  Task.where(
    '#actor lets time pass',
    Send.a(
      PostRequest.to('testing/clock/advance').with(
        Question.about('the amount of time to advance', async (actor) => ({
          milliseconds: await actor.answer(milliseconds),
        })),
      ),
    ),
  );
