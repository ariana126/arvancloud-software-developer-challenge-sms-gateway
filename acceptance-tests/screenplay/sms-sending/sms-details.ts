export interface SmsDetails {
  recipient: string;
  message: string;
}

/**
 * The feature file names a recipient and nothing else, so the message body is derived here the
 * same way `signUpDetailsOf` derives an email — the scenario names a *person*, the task layer
 * works out the payload.
 *
 * The text is deliberately not part of any contract: the backend charges a flat `costPerSms`
 * rather than a length-derived price, so nothing in these scenarios depends on what the message
 * says. It is per-actor only so a report can tell whose message is whose.
 */
export const smsDetailsOf = (
  actorName: string,
  recipient: string,
): SmsDetails => ({
  recipient,
  message: `Hello from ${actorName}`,
});
