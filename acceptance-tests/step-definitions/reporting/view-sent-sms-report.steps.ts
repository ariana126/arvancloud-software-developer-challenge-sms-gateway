import { Then, When } from '@cucumber/cucumber';
import { Actor, actorInTheSpotlight } from '@serenity-js/core';
import {
  EnsureReportExcludesAnySmsFrom,
  EnsureReportIncludesSmsTo,
  ViewTheirSentSmsReport,
} from '../../screenplay/reporting/sent-sms-report';

// The Background's `Given {actor} is a registered user` is defined once in
// step-definitions/credit, and the passive `Given {actor} has sent an SMS to {string}` in
// step-definitions/sms-sending — both reused from here exactly as they stand.

When('{actor} requests his sent SMS report', function (actor: Actor) {
  return actor.attemptsTo(ViewTheirSentSmsReport.viaApi());
});

// "his report" names nobody, so the actor is whoever the `When` left in the spotlight.
Then(
  'the SMS sent to {string} appears in his report',
  function (recipient: string) {
    return actorInTheSpotlight().attemptsTo(
      EnsureReportIncludesSmsTo(recipient),
    );
  },
);

// **The parameter types are this way round on purpose.** The report belongs to Ariana, so she is
// the `{actor}` — `actorCalled` re-summons her and takes the spotlight back from Fateme, whose
// `Given`s ran last, and the assertion then reads *her* response. Fateme is `{actorName}`: a bare
// string, no actor summoned, no spotlight moved. Inverting the two would have Fateme answering a
// question about a report she never asked for.
Then(
  "{actorName}'s SMS does not appear in {actor}'s report",
  function (otherActorName: string, actor: Actor) {
    return actor.attemptsTo(EnsureReportExcludesAnySmsFrom(otherActorName));
  },
);
