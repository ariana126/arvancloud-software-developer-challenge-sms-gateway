import { ValueObject } from '@framework/domain';

/**
 * The delivery state of a message.
 *
 * A send is accepted and charged in one transaction, published to a dispatch
 * lane after it, and delivered by a worker reading that lane some time later —
 * three separate moments, none of which can be assumed from the one before.
 * That is what these four states describe:
 *
 * - `PENDING` — accepted, charged, and owed a dispatch. An outbox row exists.
 * - `QUEUED` — the broker has it. The outbox has done its job and the row is
 *   gone, but no carrier has seen the message yet.
 * - `SENT` — the carrier took it.
 * - `FAILED` — the carrier refused it often enough that we stopped trying.
 *
 * **`QUEUED` is the state a broker made necessary.** Before there was one,
 * publishing *was* delivering, so a successful publish could honestly be
 * recorded as `SENT`. Now a successful publish means an acknowledgement from
 * Kafka and nothing more; collapsing it back into `SENT` would report messages
 * as delivered while they sit in a partition. The report filters on `SENT` for
 * exactly this reason.
 *
 * `DELIVERED` would be a fifth, once a carrier calls us back to say a handset
 * received it. Nothing does today.
 */
export class SmsStatus extends ValueObject {
  private static readonly PENDING = 'PENDING';
  private static readonly QUEUED = 'QUEUED';
  private static readonly SENT = 'SENT';
  private static readonly FAILED = 'FAILED';

  private constructor(private readonly code: string) {
    super();
  }

  static pending(): SmsStatus {
    return new SmsStatus(SmsStatus.PENDING);
  }

  static queued(): SmsStatus {
    return new SmsStatus(SmsStatus.QUEUED);
  }

  static sent(): SmsStatus {
    return new SmsStatus(SmsStatus.SENT);
  }

  static failed(): SmsStatus {
    return new SmsStatus(SmsStatus.FAILED);
  }

  /**
   * Rebuilds a status from its stored code. Now that there is more than one, a
   * message's state has to be read back rather than assumed — the mapper used
   * to hardcode `sent()` precisely because it could not be anything else.
   */
  static fromString(code: string): SmsStatus {
    switch (code) {
      case SmsStatus.PENDING: {
        return SmsStatus.pending();
      }
      case SmsStatus.QUEUED: {
        return SmsStatus.queued();
      }
      case SmsStatus.SENT: {
        return SmsStatus.sent();
      }
      case SmsStatus.FAILED: {
        return SmsStatus.failed();
      }
      default: {
        throw new Error(`Unknown SMS status: ${code}.`);
      }
    }
  }

  isSent(): boolean {
    return this.code === SmsStatus.SENT;
  }

  /**
   * The statuses this one may legally be reached from — the whole transition
   * graph, in the one place that owns the vocabulary.
   *
   * **This exists because a message now has two writers.** The API marks it
   * `QUEUED` after the broker acknowledges the publish; a worker consuming that
   * lane marks it `SENT`. Those are separate processes racing on one row, and
   * the worker frequently wins — at which point the API's `markQueued` would,
   * without this, write `QUEUED` over a `SENT` it never saw and report a
   * delivered message as undelivered for good. Forward-only is what makes the
   * two orderings agree.
   *
   * `PENDING` is reachable from nothing: it is where a message starts, written
   * in the same transaction as the charge, and nothing may ever return to it.
   */
  reachableFrom(): SmsStatus[] {
    switch (this.code) {
      case SmsStatus.PENDING: {
        return [];
      }
      case SmsStatus.QUEUED: {
        return [SmsStatus.pending()];
      }
      default: {
        return [SmsStatus.pending(), SmsStatus.queued()];
      }
    }
  }

  /** Whether moving from `current` to this status is a step forward. */
  canFollow(current: SmsStatus): boolean {
    return this.reachableFrom().some((status) => status.equals(current));
  }

  toString(): string {
    return this.code;
  }
}
