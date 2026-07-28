import { Given, Then, When } from '@cucumber/cucumber';
import { Actor } from '@serenity-js/core';

// Also matches "{actor}'s account credit is 10000 Rials" in send-sms.feature.
Given(
  "{actor}'s account credit is {int} Rials",
  function (_actor: Actor, _amount: number) {
    return 'pending';
  },
);

When(
  '{actor} sends an express SMS to {string}',
  function (_actor: Actor, _number: string) {
    return 'pending';
  },
);

// Also matches send-sms.feature's identical step text.
Then('the SMS is sent successfully', function () {
  return 'pending';
});

Then(
  '{actor} is shown the guaranteed delivery time to the operator',
  function (_actor: Actor) {
    return 'pending';
  },
);
