import { Answerable, d, Task } from '@serenity-js/core';
import { Ensure, equals } from '@serenity-js/assertions';
import { GetRequest, LastResponse, PostRequest, Send } from '@serenity-js/rest';
import {
  LogIn,
  TheirBearerToken,
  TheirOwnCredentials,
} from '../authentication/log-in';

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
 */
export class AddCredit {
  static viaApiUsing = (amount: Answerable<number>): Task =>
    Task.where(
      d`#actor adds ${amount} Rials to their account credit (via the API)`,
      LogIn.viaApiUsing(TheirOwnCredentials()),
      Send.a(
        PostRequest.to('credit/increase')
          .with({ amount })
          .using({ headers: { Authorization: TheirBearerToken() } }),
      ),
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
