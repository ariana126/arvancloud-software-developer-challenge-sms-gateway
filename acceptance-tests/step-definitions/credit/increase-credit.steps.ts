import { Given, Then, When } from '@cucumber/cucumber';
import { Actor } from '@serenity-js/core';

// Shared with the other new feature areas (reporting, sms-sending) — defined once here
// since Cucumber's step registry is global, not scoped per .steps.ts file.
Given('{actor} is a registered user', function (_actor: Actor) {
  return 'pending';
});

// Also matches "{actor}'s account credit is 0" in send-sms.feature.
Given(
  "{actor}'s account credit is {int}",
  function (_actor: Actor, _amount: number) {
    return 'pending';
  },
);

When(
  '{actor} adds {int} Rials to his account credit',
  function (_actor: Actor, _amount: number) {
    return 'pending';
  },
);

Then(
  "{actor}'s account credit becomes {int} Rials",
  function (_actor: Actor, _amount: number) {
    return 'pending';
  },
);
