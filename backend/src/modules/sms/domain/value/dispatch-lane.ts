import { ValueObject } from '@framework/domain';

import { ServiceLevel } from './service-level';
import { TrafficTier } from './traffic-tier';

/**
 * Which of the three isolated paths a dispatch travels on from here to the
 * carrier.
 *
 * A lane is a **bulkhead**. Each one has its own topic, its own consumer group
 * and its own worker process, so a backlog on one cannot lengthen the queue on
 * another. That is the entire mechanism by which this system keeps two promises
 * it would otherwise only be able to hope for: that an express message is not
 * stuck behind a marketing blast, and that a whale's Friday-evening campaign
 * does not delay a corner shop's single confirmation SMS.
 *
 * - `EXPRESS` — anything sold with a delivery-time guarantee.
 * - `BULK` — standard traffic from a high-volume sender.
 * - `SHARED` — standard traffic from everyone else.
 *
 * The lane is decided once, when the dispatch is enqueued, and recorded on the
 * outbox row. A retry therefore travels the lane the message was classified
 * into at send time rather than whatever the sender's rate happens to be
 * minutes later, which is what stops a burst from dragging its own retries
 * across lanes as it subsides.
 */
export class DispatchLane extends ValueObject {
  private static readonly EXPRESS = 'EXPRESS';
  private static readonly BULK = 'BULK';
  private static readonly SHARED = 'SHARED';

  private constructor(private readonly code: string) {
    super();
  }

  static express(): DispatchLane {
    return new DispatchLane(DispatchLane.EXPRESS);
  }

  static bulk(): DispatchLane {
    return new DispatchLane(DispatchLane.BULK);
  }

  static shared(): DispatchLane {
    return new DispatchLane(DispatchLane.SHARED);
  }

  /**
   * The whole routing rule, in one place and testable without a broker.
   *
   * **Service level wins over traffic tier.** An express message from a
   * high-volume sender goes to the express lane, not the bulk one: the tier
   * describes how much capacity a sender needs, while the level describes what
   * it was promised, and a promise made to a large customer is not worth less
   * than the same promise made to a small one.
   *
   * Express is deliberately not tiered by sender. Its guarantee is per message,
   * its volume is bounded by being the premium product, and a fourth lane would
   * buy nothing that separating it from bulk traffic has not already bought.
   */
  static for(serviceLevel: ServiceLevel, tier: TrafficTier): DispatchLane {
    if (serviceLevel.guaranteesDelivery()) {
      return DispatchLane.express();
    }
    return tier.isBulk() ? DispatchLane.bulk() : DispatchLane.shared();
  }

  static fromString(code: string): DispatchLane {
    const normalized = code.trim().toUpperCase();
    switch (normalized) {
      case DispatchLane.EXPRESS: {
        return DispatchLane.express();
      }
      case DispatchLane.BULK: {
        return DispatchLane.bulk();
      }
      case DispatchLane.SHARED: {
        return DispatchLane.shared();
      }
      default: {
        throw new Error(`Unknown dispatch lane: ${code}.`);
      }
    }
  }

  public isExpress(): boolean {
    return this.code === DispatchLane.EXPRESS;
  }

  toString(): string {
    return this.code;
  }
}
