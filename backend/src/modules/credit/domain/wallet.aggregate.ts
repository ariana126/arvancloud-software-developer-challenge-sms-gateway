import { AggregateRoot, Identity } from '@framework/domain';

import { CreditDecreased } from './events/credit-decreased.event';
import { CreditIncreased } from './events/credit-increased.event';
import { InsufficientCredit } from './service/insufficient-credit.exception';
import { Money } from './value/money';

export class Wallet extends AggregateRoot {
  constructor(
    id: Identity,
    private balance: Money,
  ) {
    super(id);
  }

  public static open(userId: Identity): Wallet {
    return new Wallet(userId, Money.rials(0));
  }

  public increase(amount: Money): void {
    if (!amount.isPositive()) {
      throw new Error('Credit amount must be positive.');
    }
    this.balance = this.balance.add(amount);
    this.recordThat(new CreditIncreased(this.id.asString(), amount.asRials()));
  }

  /**
   * Both guards run before any subtraction: `Amount` rejects a negative value
   * with a plain `Error`, which would reach a client as a 500, so a short
   * balance has to be caught here as a `DomainException` instead.
   */
  public decrease(amount: Money): void {
    if (!amount.isPositive()) {
      throw new Error('Debit amount must be positive.');
    }
    if (!this.balance.isAtLeast(amount)) {
      throw InsufficientCredit.forWallet(
        this.id,
        amount.asRials(),
        this.balance.asRials(),
      );
    }
    this.balance = this.balance.subtract(amount);
    this.recordThat(new CreditDecreased(this.id.asString(), amount.asRials()));
  }

  public getBalance(): Money {
    return this.balance;
  }

  public toPrimitives(): object {
    return {
      id: this.id.asString(),
      balance: this.balance.asRials(),
    };
  }
}
