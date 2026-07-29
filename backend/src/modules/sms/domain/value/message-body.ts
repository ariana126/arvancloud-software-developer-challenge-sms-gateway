import { ValueObject } from '@framework/domain';

/**
 * The text of a single SMS. One GSM segment, so at most 160 characters —
 * this gateway does not split a message across segments.
 */
export class MessageBody extends ValueObject {
  public static readonly MAX_LENGTH = 160;

  private constructor(private readonly value: string) {
    super();
  }

  static fromString(body: string): MessageBody {
    const normalized = body.trim();
    if (!normalized) {
      throw new Error('Message body must not be empty.');
    }
    if (normalized.length > MessageBody.MAX_LENGTH) {
      throw new Error(
        `Message body must be at most ${MessageBody.MAX_LENGTH} characters, got ${normalized.length}.`,
      );
    }
    return new MessageBody(normalized);
  }

  public length(): number {
    return this.value.length;
  }

  public asString(): string {
    return this.value;
  }

  toString(): string {
    return this.value;
  }
}
