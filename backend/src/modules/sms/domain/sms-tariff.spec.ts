import { SmsTariff } from './sms-tariff';

describe('SmsTariff', () => {
  it('one SMS costs a flat 1000 Rials', () => {
    const sut = SmsTariff.flat();
    expect(sut.costPerSms()).toBe(1000);
  });

  it('the price is quoted in Rials', () => {
    const sut = SmsTariff.flat();
    expect(sut.currency()).toBe('RIALS');
  });

  it('every reader of the tariff sees the same price', () => {
    expect(SmsTariff.flat().equals(SmsTariff.flat())).toBe(true);
  });
});
