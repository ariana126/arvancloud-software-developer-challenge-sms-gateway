import { Identity } from '@framework/domain';

import { CreditIncreased } from './events/credit-increased.event';
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
