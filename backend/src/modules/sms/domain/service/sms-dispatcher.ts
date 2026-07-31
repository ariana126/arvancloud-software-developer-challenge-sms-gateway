import { SmsDispatch } from '@sms/domain/service/sms-outbox.repository';

/**
 * Attempts one claimed dispatch and settles the outcome — publish it, then
 * either clear the row and mark the message sent, or schedule another attempt.
 *
 * **It never throws.** Its callers are a request that has already committed a
 * charge and a background relay, and neither has anything useful to do with a
 * failure: the outbox row is the record of what is still owed, so an attempt
 * that goes wrong leaves the row to be retried rather than propagating. A
 * sender is told their message was accepted, because it was.
 *
 * It is a port rather than a class the handler reaches for directly because the
 * implementation is infrastructure — it talks to the outbox and the carrier —
 * and the application layer may not import that (`.dependency-cruiser.cjs`).
 */
export abstract class SmsDispatcher {
  public abstract dispatch(dispatch: SmsDispatch): Promise<void>;
}
