import { AggregateRoot, Identity } from '@framework/domain';

import { CreditIncreased } from './events/credit-increased.event';
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
