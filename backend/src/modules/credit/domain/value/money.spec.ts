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

  it('subtracting a smaller Rial amount leaves the difference', () => {
    const sut = Money.rials(10_000).subtract(Money.rials(1000));
    expect(sut.asRials()).toBe(9000);
  });

  it('subtracting an equal amount leaves nothing', () => {
    const sut = Money.rials(1000).subtract(Money.rials(1000));
    expect(sut.asRials()).toBe(0);
  });

  it('subtracting more than there is is rejected', () => {
    expect(() => Money.rials(999).subtract(Money.rials(1000))).toThrow();
  });

  it('a larger amount is at least a smaller one', () => {
    expect(Money.rials(10_000).isAtLeast(Money.rials(1000))).toBe(true);
  });

  it('an amount is at least itself', () => {
    expect(Money.rials(1000).isAtLeast(Money.rials(1000))).toBe(true);
  });

  it('a smaller amount is not at least a larger one', () => {
    expect(Money.rials(999).isAtLeast(Money.rials(1000))).toBe(false);
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
