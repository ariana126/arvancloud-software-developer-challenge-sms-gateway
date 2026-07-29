import { ServiceLevel } from './service-level';

describe('ServiceLevel', () => {
  const SENT_AT = new Date('2026-01-01T00:00:00.000Z');
  const FIVE_MINUTES_LATER = new Date('2026-01-01T00:05:00.000Z');

  it('standard and express are different levels', () => {
    expect(ServiceLevel.standard().equals(ServiceLevel.express())).toBe(false);
  });

  it('two express levels are the same value', () => {
    expect(ServiceLevel.express().equals(ServiceLevel.express())).toBe(true);
  });

  it('a level is rebuilt from its stored code', () => {
    expect(
      ServiceLevel.fromString('EXPRESS').equals(ServiceLevel.express()),
    ).toBe(true);
    expect(
      ServiceLevel.fromString('STANDARD').equals(ServiceLevel.standard()),
    ).toBe(true);
  });

  it('an unknown code is not a service level', () => {
    expect(() => ServiceLevel.fromString('OVERNIGHT')).toThrow(
      'Unknown service level: OVERNIGHT',
    );
  });

  it('express guarantees delivery to the operator five minutes after sending', () => {
    expect(ServiceLevel.express().guaranteedDeliveryFrom(SENT_AT)).toEqual(
      FIVE_MINUTES_LATER,
    );
  });

  it('the guarantee is measured from the instant supplied, not the machine clock', () => {
    const longAgo = new Date('2020-06-15T08:30:00.000Z');
    expect(ServiceLevel.express().guaranteedDeliveryFrom(longAgo)).toEqual(
      new Date('2020-06-15T08:35:00.000Z'),
    );
  });

  it('standard guarantees nothing', () => {
    expect(
      ServiceLevel.standard().guaranteedDeliveryFrom(SENT_AT),
    ).toBeUndefined();
  });
});
