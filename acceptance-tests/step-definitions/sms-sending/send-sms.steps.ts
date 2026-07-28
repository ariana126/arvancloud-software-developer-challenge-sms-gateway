import { Given, Then, When } from '@cucumber/cucumber';
import { Actor } from '@serenity-js/core';

Given(
  "{actor}'s account credit is exactly the cost of one SMS",
  function (_actor: Actor) {
    return 'pending';
  },
);

When(
  '{actor} sends an SMS to {string}',
  function (_actor: Actor, _number: string) {
    return 'pending';
  },
);

Then(
  "the cost of the SMS is deducted from {actor}'s account credit",
  function (_actor: Actor) {
    return 'pending';
  },
);

Then(
  "{actor}'s account credit becomes {int}",
  function (_actor: Actor, _amount: number) {
    return 'pending';
  },
);

Then('the send is rejected due to insufficient credit', function () {
  return 'pending';
});

Then(
  "no cost is deducted from {actor}'s account credit",
  function (_actor: Actor) {
    return 'pending';
  },
);
