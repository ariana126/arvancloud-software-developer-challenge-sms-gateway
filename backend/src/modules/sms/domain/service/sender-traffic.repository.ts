import { Identity } from '@framework/domain';
import { TrafficPolicy } from '@sms/domain/value/traffic-policy';

/** How much a sender has sent inside the window that is currently open for it. */
export interface SenderTrafficSnapshot {
  readonly sendCountInWindow: number;
  /** When that window opened. Equal to `now` on the send that rolled it over. */
  readonly windowStartedAt: Date;
}

/**
 * The rolling count of what each sender has offered lately — the input the
 * dispatch lanes are chosen from.
 *
 * Deliberately returns a **count, not a tier**. Classifying is a domain rule and
 * belongs to `TrafficTier.forSendCount`, where it can be read and tested without
 * a database; this port only remembers how many and how recently.
 */
export abstract class SenderTrafficRepository {
  /**
   * Counts one send against the sender's current window and answers what the
   * window now holds, **including this send**.
   *
   * Two obligations on an implementation, both of which the correctness of the
   * routing rests on:
   *
   * 1. **It must be one statement.** This runs inside the send transaction,
   *    concurrently with every other send by the same customer — a read
   *    followed by a write would lose increments under exactly the load that
   *    matters, and a whale that undercounts itself stays in the shared lane and
   *    swamps it. This is the same reasoning that makes a wallet debit a guarded
   *    delta rather than a stored balance.
   * 2. **It must roll the window over in that same statement.** A window whose
   *    start has aged past `policy.getWindowInSeconds()` is restarted at `now`
   *    with a count of one, so an expired window never needs a sweeper and an
   *    idle sender's stale row costs nothing.
   */
  public abstract recordSend(
    senderId: Identity,
    now: Date,
    policy: TrafficPolicy,
  ): Promise<SenderTrafficSnapshot>;

  /**
   * The same snapshot, without counting a send against it.
   *
   * A sender with no row, or with a window that has since expired, has sent
   * nothing in the window open now — both answer zero rather than absent, so a
   * caller never has to distinguish "new customer" from "quiet customer". They
   * are the same customer as far as capacity is concerned.
   */
  public abstract findBySender(
    senderId: Identity,
    now: Date,
    policy: TrafficPolicy,
  ): Promise<SenderTrafficSnapshot>;
}
