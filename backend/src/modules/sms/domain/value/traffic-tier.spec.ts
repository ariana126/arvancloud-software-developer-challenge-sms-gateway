import { TrafficPolicy } from './traffic-policy';
import { TrafficTier } from './traffic-tier';

const POLICY = TrafficPolicy.of(1000, 60);

describe('TrafficTier', () => {
  it('a sender that has sent nothing this window is part of the long tail', () => {
    expect(TrafficTier.forSendCount(0, POLICY).toString()).toBe('SHARED');
  });

  /**
   * Strictly greater than. A threshold of 1000 means the thousandth message is
   * still ordinary traffic — the boundary belongs to the shared lane, so a
   * customer sitting exactly on its allowance is not reclassified by it.
   */
  it('a sender exactly on the threshold is still part of the long tail', () => {
    expect(TrafficTier.forSendCount(1000, POLICY).toString()).toBe('SHARED');
  });

  it('a sender past the threshold is high volume', () => {
    expect(TrafficTier.forSendCount(1001, POLICY).toString()).toBe('BULK');
  });

  it('the threshold is the policy’s to decide, not the tier’s', () => {
    const strict = TrafficPolicy.of(2, 60);

    expect(TrafficTier.forSendCount(3, strict).toString()).toBe('BULK');
    expect(TrafficTier.forSendCount(3, POLICY).toString()).toBe('SHARED');
  });

  it('reads a stored tier back', () => {
    expect(TrafficTier.fromString('bulk').isBulk()).toBe(true);
    expect(TrafficTier.fromString('SHARED').isBulk()).toBe(false);
  });

  it('refuses a tier it does not know', () => {
    expect(() => TrafficTier.fromString('PREMIUM')).toThrow(
      'Unknown traffic tier: PREMIUM.',
    );
  });
});

describe('TrafficPolicy', () => {
  it('expires a window exactly one window-length back', () => {
    const now = new Date('2026-01-01T00:01:00.000Z');

    expect(POLICY.windowExpiredBefore(now).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  /**
   * These come from environment variables, so nonsense reaches this factory
   * before it reaches anything that could be confused by it. A threshold of
   * `NaN` would classify every sender as the long tail and quietly undo the
   * isolation, which is worth a boot failure.
   */
  it.each([0, -1, 1.5, Number.NaN])('refuses a threshold of %s', (value) => {
    expect(() => TrafficPolicy.of(value, 60)).toThrow(
      /Bulk tier threshold must be a positive integer/,
    );
  });

  it.each([0, -1, Number.NaN])('refuses a window of %s seconds', (value) => {
    expect(() => TrafficPolicy.of(1000, value)).toThrow(
      /Traffic window must be a positive whole number of seconds/,
    );
  });
});
