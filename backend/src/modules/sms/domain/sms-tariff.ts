import { ValueObject } from '@framework/domain';

/**
 * What one SMS costs. This is the single place the price lives: the send path
 * charges it and the pricing query publishes it, so the two can never disagree.
 *
 * The currency is named here rather than taken from the credit module: `Money`
 * and `Currency` are internal to `credit`, and only its `domain/service/` port
 * surface crosses the module boundary. The currency is checked where money is
 * actually added and subtracted, inside `credit`.
 */
export class SmsTariff extends ValueObject {
  private static readonly COST_PER_SMS_IN_RIALS = 1000;
  private static readonly CURRENCY = 'RIALS';

  private constructor(
    private readonly cost: number,
    private readonly currencyCode: string,
  ) {
    super();
  }

  static flat(): SmsTariff {
    return new SmsTariff(SmsTariff.COST_PER_SMS_IN_RIALS, SmsTariff.CURRENCY);
  }

  public costPerSms(): number {
    return this.cost;
  }

  public currency(): string {
    return this.currencyCode;
  }

  toString(): string {
    return `${this.cost} ${this.currencyCode}`;
  }
}
