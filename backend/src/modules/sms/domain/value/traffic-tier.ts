import { ValueObject } from '@framework/domain';

import { TrafficPolicy } from './traffic-policy';

/**
 * How much of this system a sender is currently using, as a classification
 * rather than a number.
 *
 * The brief's premise is that customers do not send at the same rate: a few
 * send enormously, most send a trickle. Left in one queue the first group
 * starves the second, so the rate has to become something the routing can act
 * on — which is this type.
 *
 * - `SHARED` — the long tail. Rides the shared lane with everyone else, which
 *   is fine precisely because none of them can fill it.
 * - `BULK` — a high-volume sender, moved to its own lane so its backlog is its
 *   own problem.
 *
 * `BULK` is not a punishment and not a lower priority. It is a bulkhead: bulk
 * traffic gets capacity sized for bulk traffic, and the long tail stops
 * competing with it.
 */
export class TrafficTier extends ValueObject {
  private static readonly SHARED = 'SHARED';
  private static readonly BULK = 'BULK';

  private constructor(private readonly code: string) {
    super();
  }

  static shared(): TrafficTier {
    return new TrafficTier(TrafficTier.SHARED);
  }

  static bulk(): TrafficTier {
    return new TrafficTier(TrafficTier.BULK);
  }

  /**
   * The classification itself, and the only place it is made.
   *
   * A sender with no traffic row yet has sent nothing this window, which lands
   * on `SHARED` without needing a special case — a new customer is a quiet one
   * until it demonstrates otherwise.
   */
  static forSendCount(
    sendCountInWindow: number,
    policy: TrafficPolicy,
  ): TrafficTier {
    return policy.isBulk(sendCountInWindow)
      ? TrafficTier.bulk()
      : TrafficTier.shared();
  }

  static fromString(code: string): TrafficTier {
    const normalized = code.trim().toUpperCase();
    if (normalized === TrafficTier.SHARED) {
      return TrafficTier.shared();
    }
    if (normalized === TrafficTier.BULK) {
      return TrafficTier.bulk();
    }
    throw new Error(`Unknown traffic tier: ${code}.`);
  }

  public isBulk(): boolean {
    return this.code === TrafficTier.BULK;
  }

  toString(): string {
    return this.code;
  }
}
