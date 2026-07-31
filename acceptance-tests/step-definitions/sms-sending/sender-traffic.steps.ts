import { Given, Then, When } from '@cucumber/cucumber';
import { Actor, actorInTheSpotlight } from '@serenity-js/core';
import {
  CheckHowTheirTrafficIsClassified,
  EnsureTheirTrafficIs,
  HaveSentMoreSmsThanTheHighVolumeThreshold,
} from '../../screenplay/sms-sending/sender-traffic';

// The Background's `Given {actor} is a registered user` is defined once in step-definitions/credit
// and reused from here exactly as it stands.

// Passive voice, and the API door: the scenarios care only *that* the volume was sent, and there
// is no journey to demonstrate in a customer making the same request several thousand times. The
// third scenario is the one that needs the {actor} parameter rather than the spotlight — Fateme
// sends, Ariana asks — so the step takes the sender by name and never moves the spotlight itself.
Given(
  '{actor} has sent more SMS than the high-volume threshold',
  function (actor: Actor) {
    return actor.attemptsTo(HaveSentMoreSmsThanTheHighVolumeThreshold());
  },
);

// This is what takes the spotlight back from Fateme in the third scenario, which is the whole
// reason it names its actor instead of saying "she".
When('{actor} checks how her traffic is classified', function (actor: Actor) {
  return actor.attemptsTo(CheckHowTheirTrafficIsClassified.viaApi());
});

// "she" names nobody, so the actor is whoever the `When` left in the spotlight. The classification
// arrives as a phrase rather than as a code, and `sender-traffic.ts` maps it — a feature file that
// said "BULK" would be describing an enum rather than a business rule.
Then(
  'she is told her traffic {trafficClassification}',
  function (classification: string) {
    return actorInTheSpotlight().attemptsTo(
      EnsureTheirTrafficIs(classification),
    );
  },
);
