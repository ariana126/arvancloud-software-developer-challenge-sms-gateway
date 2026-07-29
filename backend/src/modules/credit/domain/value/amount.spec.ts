import { Amount } from './amount';

describe('Amount', () => {
  it('a non-negative integer is accepted', () => {
    const sut = Amount.fromNumber(50_000);
    expect(sut.asNumber()).toBe(50_000);
  });

  it('zero is accepted', () => {
    const sut = Amount.fromNumber(0);
    expect(sut.asNumber()).toBe(0);
  });

  it('a negative number is rejected', () => {
    expect(() => Amount.fromNumber(-1)).toThrow();
  });

  it('a non-integer number is rejected', () => {
    expect(() => Amount.fromNumber(1.5)).toThrow();
  });

  it('adding two amounts sums their values', () => {
    const sut = Amount.fromNumber(300).add(Amount.fromNumber(200));
    expect(sut.asNumber()).toBe(500);
  });

  it('subtracting a smaller amount leaves the difference', () => {
    const sut = Amount.fromNumber(500).subtract(Amount.fromNumber(200));
    expect(sut.asNumber()).toBe(300);
  });

  it('subtracting an equal amount leaves zero', () => {
    const sut = Amount.fromNumber(500).subtract(Amount.fromNumber(500));
    expect(sut.asNumber()).toBe(0);
  });

  it('subtracting more than there is is rejected', () => {
    expect(() =>
      Amount.fromNumber(500).subtract(Amount.fromNumber(501)),
    ).toThrow();
  });

  it('a larger amount is at least a smaller one', () => {
    expect(Amount.fromNumber(500).isAtLeast(Amount.fromNumber(200))).toBe(true);
  });

  it('an amount is at least itself', () => {
    expect(Amount.fromNumber(500).isAtLeast(Amount.fromNumber(500))).toBe(true);
  });

  it('a smaller amount is not at least a larger one', () => {
    expect(Amount.fromNumber(499).isAtLeast(Amount.fromNumber(500))).toBe(
      false,
    );
  });

  it('a positive amount reports itself as positive', () => {
    expect(Amount.fromNumber(1).isPositive()).toBe(true);
  });

  it('zero does not report itself as positive', () => {
    expect(Amount.fromNumber(0).isPositive()).toBe(false);
  });

  it('two amounts with the same value are equal', () => {
    expect(Amount.fromNumber(100).equals(Amount.fromNumber(100))).toBe(true);
  });

  it('two amounts with different values are not equal', () => {
    expect(Amount.fromNumber(100).equals(Amount.fromNumber(200))).toBe(false);
  });
});
