import { Currency } from './currency';

describe('Currency', () => {
  it('two Rials currencies are equal', () => {
    expect(Currency.rials().equals(Currency.rials())).toBe(true);
  });
});
