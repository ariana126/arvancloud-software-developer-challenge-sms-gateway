import { Identity } from '@framework/domain';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';

/**
 * One message waiting to be handed to the carrier, read back off the outbox.
 *
 * It carries everything a dispatch needs and nothing else — in particular it
 * does **not** carry the `SmsMessage` aggregate. The row is self-contained on
 * purpose: that is what makes it publishable as it stands, and what will let
 * `SmsDispatchPublisher` produce it to a topic without a second read.
 */
export interface SmsDispatch {
  readonly id: string;
  readonly messageId: Identity;
  readonly recipient: PhoneNumber;
  readonly body: MessageBody;
  /** How many times this has been attempted, including the attempt in hand. */
  readonly attempts: number;
}

/**
 * The transactional outbox for SMS dispatches.
 *
 * `enqueue` is written **inside the same transaction as the charge and the
 * message**, which is the whole point: handing the message to a carrier (or
 * producing it to a broker) from the handler would be a second write to a second
 * system with no shared transaction, and the two would disagree the first time
 * either one failed.
 */
export abstract class SmsOutboxRepository {
  /**
   * Records a message as owed a dispatch, already claimed by the caller.
   *
   * Claimed rather than pending because the request is about to attempt it
   * immediately, and a row left claimable would be raced by the relay in that
   * window. If the request dies mid-attempt the claim goes stale and
   * `claimAbandoned` picks it up.
   */
  public abstract enqueue(message: SmsMessage, now: Date): Promise<SmsDispatch>;

  /**
   * Claims up to `limit` dispatches that are due — those rescheduled after a
   * failure, and those whose claim has gone stale because whoever held it died.
   *
   * Implementations must make the claim atomic, so that two app instances
   * polling at the same moment never receive the same row.
   */
  public abstract claimAbandoned(
    limit: number,
    now: Date,
  ): Promise<SmsDispatch[]>;

  /** The dispatch succeeded; the row has done its job and goes away. */
  public abstract settle(id: string): Promise<void>;

  /** The dispatch failed; try again no earlier than `nextAttemptAt`. */
  public abstract reschedule(
    id: string,
    nextAttemptAt: Date,
    error: string,
  ): Promise<void>;

  /** We have stopped trying. The row stays, for someone to look at. */
  public abstract deadLetter(id: string, error: string): Promise<void>;
}
