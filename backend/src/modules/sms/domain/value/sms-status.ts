import { ValueObject } from '@framework/domain';

/**
 * The delivery state of a message.
 *
 * A send is accepted and charged in one transaction and handed to the carrier
 * after it, so a message exists before anyone knows whether it went out. That
 * gap is what these three states describe:
 *
 * - `PENDING` — accepted, charged, and owed a dispatch. An outbox row exists.
 * - `SENT` — the carrier took it.
 * - `FAILED` — the carrier refused it often enough that we stopped trying, and
 *   the outbox row is dead-lettered for someone to look at.
 *
 * `DELIVERED` would be a fourth, once a carrier calls us back to say a handset
 * received it. Nothing does today.
 */
export class SmsStatus extends ValueObject {
  private static readonly PENDING = 'PENDING';
  private static readonly SENT = 'SENT';
  private static readonly FAILED = 'FAILED';

  private constructor(private readonly code: string) {
    super();
  }

  static pending(): SmsStatus {
    return new SmsStatus(SmsStatus.PENDING);
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
