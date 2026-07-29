import { ValueObject } from '@framework/domain';

/**
 * The delivery state of a message. This gateway dispatches synchronously and
 * has no callback from the provider, so `SENT` is the only state a persisted
 * message can be in — the type exists so adding `FAILED` or `DELIVERED` later
 * is a new factory rather than a new concept.
 */
export class SmsStatus extends ValueObject {
  private constructor(private readonly code: string) {
    super();
  }

  static sent(): SmsStatus {
    return new SmsStatus('SENT');
  }

  toString(): string {
    return this.code;
  }
}
