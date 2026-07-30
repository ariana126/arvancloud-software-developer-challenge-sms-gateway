import { Given, Then, When } from '@cucumber/cucumber';
import { Actor, actorInTheSpotlight } from '@serenity-js/core';
import { EnsureAccountCreditIs } from '../../screenplay/credit/account-credit';
import {
  EnsureNoCostWasDeducted,
  EnsureSendRejectedForInsufficientCredit,
  EnsureSmsSent,
  EnsureTheCostOfOneSmsWasDeducted,
  HaveAlreadySentAnSms,
  SendAnSms,
} from '../../screenplay/sms-sending/send-sms';
import { smsDetailsOf } from '../../screenplay/sms-sending/sms-details';
import { StartWithJustEnoughCreditForOneSms } from '../../screenplay/sms-sending/sms-pricing';

// The two credit preconditions worded with a number ("is 0", "is 10000 Rials") live in
// step-definitions/credit — credit is their domain, and both SMS features share them.
Given(
  "{actor}'s account credit is exactly the cost of one SMS",
  function (actor: Actor) {
    return actor.attemptsTo(StartWithJustEnoughCreditForOneSms());
  },
);

// Passive voice — view-sent-sms-report.feature cares only *that* the message went out, so this
// takes the API door where the `When` below drives the browser. Same goal, two voices, two doors,
// deliberately side by side: this is what the blended split looks like when you can see both
// halves at once. It lives here rather than with reporting for the reason the credit `Given`s live
// with credit — sending is this file's domain, and Cucumber's step registry is global anyway.
Given(
  '{actor} has sent an SMS to {string}',
  function (actor: Actor, recipient: string) {
    return actor.attemptsTo(
      HaveAlreadySentAnSms(smsDetailsOf(actor.name, recipient)),
    );
  },
);

// Active voice, and the journey this product exists for — so it goes through the browser.
// The recipient comes from the scenario; the message body is derived (see sms-details.ts).
When(
  '{actor} sends an SMS to {string}',
  function (actor: Actor, recipient: string) {
    return actor.attemptsTo(
      SendAnSms.using(smsDetailsOf(actor.name, recipient)),
    );
  },
);

// Moved here from send-express-sms.steps.ts: Cucumber's step registry is global, and this is the
// feature that implements the step. Express only reaches it after its own `When`, which stays
// pending, so it is skipped there.
Then('the SMS is sent successfully', function () {
  return actorInTheSpotlight().attemptsTo(EnsureSmsSent());
});

Then(
  "the cost of the SMS is deducted from {actor}'s account credit",
  function (actor: Actor) {
    return actor.attemptsTo(EnsureTheCostOfOneSmsWasDeducted());
  },
);

// No "Rials" here, where increase-credit.feature's near-twin has one. Cucumber expressions are
// anchored, so the two never compete.
Then(
  "{actor}'s account credit becomes {int}",
  function (actor: Actor, amount: number) {
    return actor.attemptsTo(EnsureAccountCreditIs(amount));
  },
);

Then('the send is rejected due to insufficient credit', function () {
  return actorInTheSpotlight().attemptsTo(
    EnsureSendRejectedForInsufficientCredit(),
  );
});

Then(
  "no cost is deducted from {actor}'s account credit",
  function (actor: Actor) {
    return actor.attemptsTo(EnsureNoCostWasDeducted());
  },
);
