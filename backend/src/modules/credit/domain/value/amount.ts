import { ValueObject } from '@framework/domain';

export class Amount extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static fromNumber(value: number): Amount {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `Invalid amount: ${value}. Must be a non-negative integer.`,
      );
    }
    return new Amount(value);
  }

  public add(other: Amount): Amount {
    return Amount.fromNumber(this.value + other.value);
  }

  public isPositive(): boolean {
    return this.value > 0;
  }

  public asNumber(): number {
    return this.value;
  }

  toString(): string {
    return this.value.toString();
  }
}
