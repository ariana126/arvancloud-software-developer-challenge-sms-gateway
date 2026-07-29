import { ValueObject } from '@framework/domain';

export class Currency extends ValueObject {
  private constructor(private readonly code: string) {
    super();
  }

  static rials(): Currency {
    return new Currency('RIALS');
  }

  toString(): string {
    return this.code;
  }
}
