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
