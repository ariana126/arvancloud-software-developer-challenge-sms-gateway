import { Given, Then, When } from '@cucumber/cucumber';
import { Actor } from '@serenity-js/core';

Given(
  '{actor} has sent an SMS to {string}',
  function (_actor: Actor, _number: string) {
    return 'pending';
  },
);

When('{actor} requests his sent SMS report', function (_actor: Actor) {
  return 'pending';
});

Then(
  'the SMS sent to {string} appears in his report',
  function (_number: string) {
    return 'pending';
  },
);

Then(
  "{actor}'s SMS does not appear in {actorName}'s report",
  function (_actor: Actor, _otherActorName: string) {
    return 'pending';
  },
);
