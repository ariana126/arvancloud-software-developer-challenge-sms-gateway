import { ValueObject } from '@framework/domain';

import { Amount } from './amount';
import { Currency } from './currency';

export class Money extends ValueObject {
  private constructor(
    private readonly amount: Amount,
    private readonly currency: Currency,
  ) {
    super();
  }

  static rials(value: number): Money {
    return new Money(Amount.fromNumber(value), Currency.rials());
  }

  public add(other: Money): Money {
    if (!this.currency.equals(other.currency)) {
      throw new Error('Cannot add money amounts in different currencies.');
    }
    return new Money(this.amount.add(other.amount), this.currency);
  }

  /**
   * Callers must establish `isAtLeast(other)` first — subtracting past zero
   * throws a plain `Error` from `Amount`, which reaches a client as a 500.
   */
  public subtract(other: Money): Money {
    if (!this.currency.equals(other.currency)) {
      throw new Error('Cannot subtract money amounts in different currencies.');
    }
    return new Money(this.amount.subtract(other.amount), this.currency);
  }

  public isAtLeast(other: Money): boolean {
    if (!this.currency.equals(other.currency)) {
      throw new Error('Cannot compare money amounts in different currencies.');
    }
    return this.amount.isAtLeast(other.amount);
  }

  public isPositive(): boolean {
    return this.amount.isPositive();
  }

  public asRials(): number {
    return this.amount.asNumber();
  }

  toString(): string {
    return `${this.amount.toString()} ${this.currency.toString()}`;
  }
}
