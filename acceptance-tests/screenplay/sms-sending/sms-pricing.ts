import { notes, QuestionAdapter, Task } from '@serenity-js/core';
import { Ensure, equals } from '@serenity-js/assertions';
import { GetRequest, LastResponse, Send } from '@serenity-js/rest';
import {
  LogIn,
  TheirBearerToken,
  TheirOwnCredentials,
} from '../authentication/log-in';
import { AccountNotes } from '../common/notes';
import { StartWithAccountCreditOf } from '../credit/account-credit';

interface SmsPricingBody {
  costPerSms: number;
  currency: string;
}

/**
 * Looks the flat per-SMS price up and writes it to the notepad.
 *
 * Deliberately a **task** rather than a question that fetches. A `TheCostOfOneSms()` that issued
 * a `GET` would fire in the middle of an assertion reading `LastResponse` — the pricing response
 * would become the last one, and the assertion would compare the credit response against a body
 * it had just clobbered. So fetching is an activity the actor performs at a moment we choose, and
 * reading is a notepad lookup that touches no HTTP at all.
 *
 * Contract: `GET sms/pricing`, bearer-authenticated, `200 { costPerSms, currency: 'RIALS' }`.
 */
export const LookUpTheCostOfOneSms = (): Task =>
  Task.where(
    '#actor looks up the cost of one SMS',
    // The same arrangement as the credit tasks: this door has no browser to carry a session, so
    // the actor logs in immediately beforehand and reads the token off that response.
    LogIn.viaApiUsing(TheirOwnCredentials()),
    Send.a(
      GetRequest.to('sms/pricing').using({
        headers: { Authorization: TheirBearerToken() },
      }),
    ),
    // Checked before the note is written, so that a pricing endpoint which isn't there yet fails
    // as "expected 404 to equal 200" rather than as an `equals(undefined)` three steps later,
    // once an unwritten note has been read back by an assertion that had nothing to do with it.
    Ensure.that(LastResponse.status(), equals(200)),
    notes<AccountNotes>().set(
      'costPerSms',
      LastResponse.body<SmsPricingBody>().costPerSms,
    ),
  );

/** A notepad read. Performs no request, so it is safe anywhere — see above. */
export const TheCostOfOneSms = (): QuestionAdapter<number> =>
  notes<AccountNotes>().get('costPerSms');

/**
 * "Ariana's account credit is exactly the cost of one SMS" — the only precondition in the suite
 * that has to ask the system what a number is before it can establish it.
 *
 * The lookup runs first and the credit request last, so whatever `LastResponse` holds afterwards
 * belongs to the credit call rather than to pricing.
 */
export const StartWithJustEnoughCreditForOneSms = (): Task =>
  Task.where(
    '#actor starts with just enough credit for one SMS',
    LookUpTheCostOfOneSms(),
    StartWithAccountCreditOf(TheCostOfOneSms()),
  );
