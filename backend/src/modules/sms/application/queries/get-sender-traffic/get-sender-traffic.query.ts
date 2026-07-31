import { Identity } from '@framework/domain';

/**
 * A sender asking about its own traffic. Like `GetSentSmsReportQuery`, the
 * sender is the only input and that *is* the authorization — there is no
 * request-supplied identifier that could name somebody else's usage.
 */
export class GetSenderTrafficQuery {
  constructor(public readonly senderId: Identity) {}
}
