import {
  Answerable,
  Check,
  d,
  notes,
  Question,
  QuestionAdapter,
  Task,
} from '@serenity-js/core';
import { Ensure, equals, isGreaterThan } from '@serenity-js/assertions';
import { GetRequest, LastResponse, PostRequest, Send } from '@serenity-js/rest';
import {
  LogIn,
  TheirBearerToken,
  TheirOwnCredentials,
} from '../authentication/log-in';
import { AccountNotes } from '../common/notes';

interface AccountCreditBody {
  amount: number;
}

/**
 * Adding funds to an actor's account credit.
 *
 * Only one route exists today — the amount is posted straight to the API, there is no frontend
 * for credit yet. Named `.viaApiUsing` rather than a bare `.using` even so, so it stays
 * self-documenting and doesn't collide with the `SignUp.using` = "via the UI" idiom used
 * elsewhere, should a UI route (`AddCredit.using`) ever be added alongside it.
 *
 * Contract: `POST credit/increase`, bearer-authenticated, body `{ amount }`,
 * `204 No Content` on success.
 *
 * **`.with()` does not resolve answerables nested in an object literal, and `.using()` does.**
 * That asymmetry is in Serenity itself: `PostRequest.using(config)` wraps its argument in
 * `Question.fromObject(...)`, while `.with(data)` stores it as-is and `HTTPRequest.answeredBy`
 * merely calls `actor.answer(data)` — which resolves a *Question*, not the questions inside a
 * plain object. So `.with({ amount })` where `amount` is a `QuestionAdapter` serialises to `{}`,
 * silently: the proxy has no JSON representation, `Send.a()` asserts no status, and the request
 * is rejected without anything failing. It worked for `AddCredit.viaApiUsing(50_000)` and broke
 * the moment the amount came from a note. Hence `Question.fromObject` here — it is correct for
 * literals too, so this is the shape to reach for in any `.with()` built from an object literal.
 * (`screenplay/common/clock.ts` solves the same problem the other way, by resolving inside a
 * `Question.about`.)
 */
export class AddCredit {
  static viaApiUsing = (amount: Answerable<number>): Task =>
    Task.where(
      d`#actor adds ${amount} Rials to their account credit (via the API)`,
      LogIn.viaApiUsing(TheirOwnCredentials()),
      Send.a(
        PostRequest.to('credit/increase')
          .with(Question.fromObject<AccountCreditBody>({ amount }))
          .using({ headers: { Authorization: TheirBearerToken() } }),
      ),
      // A precondition that quietly fails to establish its precondition is the worst kind: without
      // this, a rejected top-up left the balance at 0 and the failure surfaced two activities later
      // as a puzzling "expected 1000, received 0".
      Ensure.that(LastResponse.status(), equals(204)),
    );
}

/**
 * Checks the actor's current account credit against an expected amount.
 *
 * Reused on both sides of this scenario: as the `Given` that confirms the starting balance
 * (today always 0, the default for a freshly registered actor) and as the `Then` that confirms
 * the balance after `AddCredit`. It is also the natural task for `send-sms.feature`'s identically
 * worded `Given {actor}'s account credit is {int}` to reuse once that feature area is wired up.
 *
 * Contract: `GET credit`, bearer-authenticated, `200 { amount }`.
 */
export const EnsureAccountCreditIs = (amount: Answerable<number>): Task =>
  Task.where(
    d`#actor ensures their account credit is ${amount} Rials`,
    LogIn.viaApiUsing(TheirOwnCredentials()),
    Send.a(
      GetRequest.to('credit').using({
        headers: { Authorization: TheirBearerToken() },
      }),
    ),
    Ensure.that(LastResponse.body<AccountCreditBody>().amount, equals(amount)),
  );

/**
 * The balance a scenario starts from: established, proven, and remembered.
 *
 * This is what every credit-precondition `Given` takes, where {@link EnsureAccountCreditIs} only
 * ever *asserts* — it satisfies "is 0" by accident, because a freshly registered actor already
 * has nothing, and cannot satisfy "is 10000 Rials" at all.
 *
 * Every scenario runs against a truncated database and registers its actor moments earlier, so
 * the balance always starts at 0 and any target is one top-up away. The `Check` is what lets 0
 * and 10000 share one task: posting an increase of 0 is not something the API promises to
 * accept, and at 0 there is nothing to do but confirm it.
 *
 * The note it leaves behind is what lets the `Then` steps of send-sms.feature talk about "the
 * cost deducted" and "no cost deducted" without restating a figure the Gherkin already gave.
 */
export const StartWithAccountCreditOf = (amount: Answerable<number>): Task =>
  Task.where(
    d`#actor starts with an account credit of ${amount} Rials`,
    Check.whether(amount, isGreaterThan(0)).andIfSo(
      AddCredit.viaApiUsing(amount),
    ),
    EnsureAccountCreditIs(amount),
    notes<AccountNotes>().set('startingAccountCredit', amount),
  );

export const TheAccountCreditTheyStartedWith = (): QuestionAdapter<number> =>
  notes<AccountNotes>().get('startingAccountCredit');
