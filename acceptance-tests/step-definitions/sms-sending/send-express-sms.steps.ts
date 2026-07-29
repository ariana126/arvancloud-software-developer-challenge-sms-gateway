import { Then, When } from '@cucumber/cucumber';
import { Actor } from '@serenity-js/core';

// Two steps this file used to define have moved, because Cucumber's step registry is global and
// neither is express-specific: the credit precondition to step-definitions/credit (its domain,
// beside its "is {int}" sibling), and "the SMS is sent successfully" to send-sms.steps.ts (the
// feature that implements it). Express pends at its own `When`, so it never reaches the latter.
When(
  '{actor} sends an express SMS to {string}',
  function (_actor: Actor, _number: string) {
    return 'pending';
  },
);

Then(
  '{actor} is shown the guaranteed delivery time to the operator',
  function (_actor: Actor) {
    return 'pending';
  },
);
