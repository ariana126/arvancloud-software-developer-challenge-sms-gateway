/**
 * How much service a send buys. Express is **a service level on a send**, not a different endpoint
 * and not a different price — the flat `SmsTariff` is unchanged — so it travels in the details
 * alongside the recipient rather than in the name of a task.
 *
 * That is also why there is no `SendAnSms.expressUsing`: in this suite the method name carries the
 * *door* (`.using` = the browser, `.viaApiUsing` = the API) and nothing else. Overloading it with a
 * service level would give four methods the day reporting's passive `Given {actor} has sent an SMS`
 * wants an API route; carrying it in the data keeps that to `viaApiUsing(expressSmsDetailsOf(…))`.
 *
 * A union rather than an `express: boolean`, because "service level" is the product's own word and
 * a third level would fit without changing a signature.
 */
export type SmsServiceLevel = 'standard' | 'express';

export interface SmsDetails {
  recipient: string;
  message: string;
  serviceLevel: SmsServiceLevel;
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
  serviceLevel: 'standard',
});

/**
 * The same message, sent at the express service level. Express changes the *service*, not the
 * text — and not the price — so everything else is derived exactly as above.
 */
export const expressSmsDetailsOf = (
  actorName: string,
  recipient: string,
): SmsDetails => ({
  ...smsDetailsOf(actorName, recipient),
  serviceLevel: 'express',
});
