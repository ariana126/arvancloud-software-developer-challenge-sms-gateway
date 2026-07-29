import { Identity } from '@framework/domain';

import { CreditDecreased } from './events/credit-decreased.event';
import { CreditIncreased } from './events/credit-increased.event';
import { InsufficientCredit } from './service/insufficient-credit.exception';
import { Money } from './value/money';
import { Wallet } from './wallet.aggregate';

describe('Wallet', () => {
  it('a newly opened wallet is keyed by the given user id', () => {
    const userId = Identity.new();
    const sut = Wallet.open(userId);
    expect(sut.id.equals(userId)).toBe(true);
  });

  it('a newly opened wallet has a zero balance', () => {
    const sut = Wallet.open(Identity.new());
    expect(sut.getBalance().equals(Money.rials(0))).toBe(true);
  });

  it('opening a wallet records no domain event', () => {
    const sut = Wallet.open(Identity.new());
    expect(sut.releaseEvents()).toEqual([]);
  });

  it('increasing credit adds to the current balance', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(50_000));
    expect(sut.getBalance().equals(Money.rials(50_000))).toBe(true);
  });

  it('increasing credit twice accumulates the balance', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(30_000));
    sut.increase(Money.rials(20_000));
    expect(sut.getBalance().equals(Money.rials(50_000))).toBe(true);
  });

  it('increasing credit records a CreditIncreased event with the user id and amount', () => {
    const userId = Identity.new();
    const sut = Wallet.open(userId);
    sut.increase(Money.rials(50_000));
    expect(sut.releaseEvents()).toEqual([
      new CreditIncreased(userId.asString(), 50_000),
    ]);
  });

  it('increasing by a zero amount is rejected', () => {
    const sut = Wallet.open(Identity.new());
    expect(() => sut.increase(Money.rials(0))).toThrow();
  });

  it('a rejected increase does not change the balance', () => {
    const sut = Wallet.open(Identity.new());
    expect(() => sut.increase(Money.rials(0))).toThrow();
    expect(sut.getBalance().equals(Money.rials(0))).toBe(true);
  });

  it('a rejected increase does not record an event', () => {
    const sut = Wallet.open(Identity.new());
    expect(() => sut.increase(Money.rials(0))).toThrow();
    expect(sut.releaseEvents()).toEqual([]);
  });

  it('decreasing credit takes it off the current balance', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(10_000));
    sut.decrease(Money.rials(1000));
    expect(sut.getBalance().equals(Money.rials(9000))).toBe(true);
  });

  it('spending the whole balance leaves nothing', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(1000));
    sut.decrease(Money.rials(1000));
    expect(sut.getBalance().equals(Money.rials(0))).toBe(true);
  });

  it('decreasing credit records a CreditDecreased event with the user id and amount', () => {
    const userId = Identity.new();
    const sut = Wallet.open(userId);
    sut.increase(Money.rials(10_000));
    sut.releaseEvents();
    sut.decrease(Money.rials(1000));
    expect(sut.releaseEvents()).toEqual([
      new CreditDecreased(userId.asString(), 1000),
    ]);
  });

  it('spending more than the balance holds is rejected as insufficient credit', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(999));
    expect(() => sut.decrease(Money.rials(1000))).toThrow(InsufficientCredit);
  });

  it('spending against an empty wallet is rejected as insufficient credit', () => {
    const sut = Wallet.open(Identity.new());
    expect(() => sut.decrease(Money.rials(1000))).toThrow(InsufficientCredit);
  });

  it('a rejected decrease does not change the balance', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(999));
    expect(() => sut.decrease(Money.rials(1000))).toThrow();
    expect(sut.getBalance().equals(Money.rials(999))).toBe(true);
  });

  it('a rejected decrease does not record an event', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(999));
    sut.releaseEvents();
    expect(() => sut.decrease(Money.rials(1000))).toThrow();
    expect(sut.releaseEvents()).toEqual([]);
  });

  it('an insufficient charge reports what was required and what was available', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(999));

    let rejection: InsufficientCredit | undefined;
    try {
      sut.decrease(Money.rials(1000));
    } catch (error) {
      rejection = error as InsufficientCredit;
    }

    expect(rejection?.required).toBe(1000);
    expect(rejection?.available).toBe(999);
  });

  it('decreasing by a zero amount is rejected', () => {
    const sut = Wallet.open(Identity.new());
    sut.increase(Money.rials(10_000));
    expect(() => sut.decrease(Money.rials(0))).toThrow();
  });

  it('toPrimitives returns the id and balance in Rials', () => {
    const userId = Identity.new();
    const sut = Wallet.open(userId);
    sut.increase(Money.rials(50_000));
    expect(sut.toPrimitives()).toEqual({
      id: userId.asString(),
      balance: 50_000,
    });
  });
});
