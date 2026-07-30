import { Identity } from '@framework/domain';

/**
 * Asks for one sender's report of the messages they have sent.
 *
 * The sender is the **only** input, and that is the whole scoping mechanism:
 * there is no request-supplied identifier that could name somebody else's
 * report, so the question "may this caller read this data?" never has to be
 * asked. The controller fills this from `@CurrentUser()`.
 *
 * `senderId` rather than `userId` — inside `sms` the actor is the sender, the
 * same word `SmsMessage` and `SendSmsCommand` already use.
 */
export class GetSentSmsReportQuery {
  constructor(public readonly senderId: Identity) {}
}
