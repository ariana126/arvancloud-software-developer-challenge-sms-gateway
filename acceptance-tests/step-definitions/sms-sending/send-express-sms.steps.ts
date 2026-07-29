import { Then, When } from '@cucumber/cucumber';
import { Actor } from '@serenity-js/core';
import {
  EnsureGuaranteedDeliveryTimeShown,
  SendAnSms,
} from '../../screenplay/sms-sending/send-sms';
import { expressSmsDetailsOf } from '../../screenplay/sms-sending/sms-details';

// Two steps this file used to define have moved, because Cucumber's step registry is global and
// neither is express-specific: the credit precondition to step-definitions/credit (its domain,
// beside its "is {int}" sibling), and "the SMS is sent successfully" to send-sms.steps.ts (the
// feature that implements it). Both are reused from here exactly as they stand.

// Active voice, so it goes through the browser — and the *same* door and the same task as an
// ordinary send, because express is a service level on a send rather than a different journey.
// That is why this is `SendAnSms.using` and not a second method: the difference lives entirely in
// the details it is handed (see sms-details.ts for why the service level travels in the data).
When(
  '{actor} sends an express SMS to {string}',
  function (actor: Actor, recipient: string) {
    return actor.attemptsTo(
      SendAnSms.using(expressSmsDetailsOf(actor.name, recipient)),
    );
  },
);

// `{actor}` rather than `{actorName}`: one actor in this scenario, so re-summoning Ariana leaves
// the spotlight exactly where the preceding `Then` found it.
Then(
  '{actor} is shown the guaranteed delivery time to the operator',
  function (actor: Actor) {
    return actor.attemptsTo(EnsureGuaranteedDeliveryTimeShown());
  },
);
