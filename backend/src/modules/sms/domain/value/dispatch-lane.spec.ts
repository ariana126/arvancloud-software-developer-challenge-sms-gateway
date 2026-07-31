import { DispatchLane } from './dispatch-lane';
import { ServiceLevel } from './service-level';
import { TrafficTier } from './traffic-tier';

describe('DispatchLane', () => {
  describe('routing', () => {
    it('sends the long tail down the shared lane', () => {
      const lane = DispatchLane.for(
        ServiceLevel.standard(),
        TrafficTier.shared(),
      );

      expect(lane.toString()).toBe('SHARED');
    });

    /**
     * The noisy-neighbour bulkhead: a high-volume sender's standard traffic
     * leaves the lane the long tail shares, so its backlog stops being
     * everyone else's.
     */
    it('moves a high-volume sender to its own lane', () => {
      const lane = DispatchLane.for(
        ServiceLevel.standard(),
        TrafficTier.bulk(),
      );

      expect(lane.toString()).toBe('BULK');
    });

    it('sends a guaranteed message down the express lane', () => {
      const lane = DispatchLane.for(
        ServiceLevel.express(),
        TrafficTier.shared(),
      );

      expect(lane.toString()).toBe('EXPRESS');
    });

    /**
     * Service level beats traffic tier, and this is the case that says so. A
     * delivery guarantee sold to a large customer is worth exactly what the
     * same guarantee sold to a small one is worth, so being high-volume must
     * not demote an express message into the bulk lane.
     */
    it('keeps an express message from a high-volume sender on the express lane', () => {
      const lane = DispatchLane.for(ServiceLevel.express(), TrafficTier.bulk());

      expect(lane.toString()).toBe('EXPRESS');
    });
  });

  describe('reconstruction', () => {
    it.each(['EXPRESS', 'BULK', 'SHARED'])('reads %s back', (code) => {
      expect(DispatchLane.fromString(code).toString()).toBe(code);
    });

    it('is case and whitespace insensitive, as the env var it is read from', () => {
      expect(DispatchLane.fromString('  express ').toString()).toBe('EXPRESS');
    });

    /**
     * A worker is told its lane by an environment variable, so a typo has to be
     * a boot failure. Defaulting would leave a lane silently unconsumed, which
     * is the exact outage the lanes exist to prevent.
     */
    it('refuses a lane it does not know', () => {
      expect(() => DispatchLane.fromString('URGENT')).toThrow(
        'Unknown dispatch lane: URGENT.',
      );
    });
  });

  it('only the express lane is express', () => {
    expect(DispatchLane.express().isExpress()).toBe(true);
    expect(DispatchLane.bulk().isExpress()).toBe(false);
    expect(DispatchLane.shared().isExpress()).toBe(false);
  });
});
