import { notes, QuestionAdapter } from '@serenity-js/core';
import { SignUpPayload } from '../registration/sign-up-details';
import { SmsDetails } from '../sms-sending/sms-details';

/**
 * Each actor keeps their own notepad (see support/actors.ts), so these read back
 * whatever the *answering* actor noted down — no need to name them.
 *
 * One notepad type serves the whole suite: anything a scenario has to remember from one step to
 * the next belongs here, whichever feature area writes it. The *accessor* questions live with
 * their feature area unless more than one reads them — which is why `TheDetailsTheySignedUpWith`
 * is below (registration, authentication and profile all ask it) and `TheCostOfOneSms` is not.
 */
export interface AccountNotes {
  /** What the actor actually submitted to sign up — invalid or incomplete payloads included. */
  details: SignUpPayload;

  /**
   * The balance a credit `Given` established. Remembering it lets a later `Then` say "less the
   * cost of one SMS" instead of repeating a number the scenario has already stated.
   */
  startingAccountCredit: number;

  /**
   * The flat per-SMS price, looked up from the API **once** and read back from here afterwards.
   * A question that fetched it on demand would overwrite the `LastResponse` the assertion around
   * it is reading — hence a task that writes, and a question that only reads.
   */
  costPerSms: number;

  /** What the actor sent, so the confirmation can be checked against the recipient they typed. */
  sms: SmsDetails;

  /**
   * The number of sends per window above which a customer's traffic is carried separately from
   * the long tail's, looked up from the API rather than written down here — the test stack runs
   * it far lower than production would, and a literal in this suite would be a copy of a
   * configuration value it has no business knowing. A note for the same reason `costPerSms` is
   * one: fetching it inside a question would clobber the `LastResponse` around it.
   */
  highVolumeThreshold: number;

  /**
   * The HTTP status each of two simultaneous sends answered with. Kept here rather than read off
   * `LastResponse`, because the whole point of that scenario is that two requests were in flight
   * at once — there is no single "last response" to ask about.
   */
  sendOutcomes: number[];

  /**
   * The instant, as an ISO-8601 string, that the backend clock was frozen at for a send — so an
   * assertion about a *future* guarantee has something in the system's own timeline to compare
   * against. The host's wall clock is no use here: the backend starts every scenario frozen in the
   * past, so "later than now" would be measured against the wrong calendar entirely.
   */
  sentAt: string;
}

export const TheDetailsTheySignedUpWith = (): QuestionAdapter<SignUpPayload> =>
  notes<AccountNotes>().get('details');
