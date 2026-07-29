import { Given, Then, When } from '@cucumber/cucumber';
import { Actor } from '@serenity-js/core';
import {
  AddCredit,
  EnsureAccountCreditIs,
} from '../../screenplay/credit/account-credit';
import { EnsureSignedUp, SignUp } from '../../screenplay/registration/sign-up';
import { signUpDetailsOf } from '../../screenplay/registration/sign-up-details';

// Shared with the other new feature areas (reporting, sms-sending) — defined once here
// since Cucumber's step registry is global, not scoped per .steps.ts file.
// Passive voice — we care only *that* the account exists, so take the API shortcut. This
// reuses the registration vocabulary as-is; there is nothing credit-specific about signing up.
Given('{actor} is a registered user', function (actor: Actor) {
  return actor.attemptsTo(
    SignUp.viaApiUsing(signUpDetailsOf(actor.name)),
    EnsureSignedUp(),
  );
});

// Also matches "{actor}'s account credit is 0" in send-sms.feature.
Given(
  "{actor}'s account credit is {int}",
  function (actor: Actor, amount: number) {
    return actor.attemptsTo(EnsureAccountCreditIs(amount));
  },
);

When(
  '{actor} adds {int} Rials to his account credit',
  function (actor: Actor, amount: number) {
    return actor.attemptsTo(AddCredit.viaApiUsing(amount));
  },
);

Then(
  "{actor}'s account credit becomes {int} Rials",
  function (actor: Actor, amount: number) {
    return actor.attemptsTo(EnsureAccountCreditIs(amount));
  },
);
