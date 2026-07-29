import { Money } from './money';

describe('Money', () => {
  it('a non-negative integer amount of Rials is accepted', () => {
    const sut = Money.rials(50_000);
    expect(sut.asRials()).toBe(50_000);
  });

  it('a negative amount is rejected', () => {
    expect(() => Money.rials(-1)).toThrow();
  });

  it('a non-integer amount is rejected', () => {
    expect(() => Money.rials(1.5)).toThrow();
  });

  it('adding two Rial amounts sums them', () => {
    const sut = Money.rials(300).add(Money.rials(200));
    expect(sut.asRials()).toBe(500);
  });

  it('a positive amount reports itself as positive', () => {
    expect(Money.rials(1).isPositive()).toBe(true);
  });

  it('zero does not report itself as positive', () => {
    expect(Money.rials(0).isPositive()).toBe(false);
  });

  it('two Money values with the same amount are equal', () => {
    expect(Money.rials(100).equals(Money.rials(100))).toBe(true);
  });

  it('two Money values with different amounts are not equal', () => {
    expect(Money.rials(100).equals(Money.rials(200))).toBe(false);
  });
});
