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

  toString(): string {
    return this.code;
  }
}
