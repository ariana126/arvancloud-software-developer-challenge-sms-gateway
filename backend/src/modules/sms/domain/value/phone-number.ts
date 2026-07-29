import { ValueObject } from '@framework/domain';

/**
 * An Iranian mobile number, in either the local (`09121234567`) or the
 * international (`+989121234567`) form. Both normalise to the local form, so
 * two spellings of the same number are one value.
 */
export class PhoneNumber extends ValueObject {
  private static readonly LOCAL = /^09\d{9}$/;
  private static readonly INTERNATIONAL = /^\+989\d{9}$/;

  private constructor(private readonly value: string) {
    super();
  }

  static fromString(phoneNumber: string): PhoneNumber {
    const normalized = PhoneNumber.normalize(phoneNumber.trim());
    if (!PhoneNumber.LOCAL.test(normalized)) {
      throw new Error(`Invalid mobile number: ${phoneNumber}`);
    }
    return new PhoneNumber(normalized);
  }

  private static normalize(phoneNumber: string): string {
    return PhoneNumber.INTERNATIONAL.test(phoneNumber)
      ? `0${phoneNumber.slice('+98'.length)}`
      : phoneNumber;
  }

  public asString(): string {
    return this.value;
  }

  toString(): string {
    return this.value;
  }
}
