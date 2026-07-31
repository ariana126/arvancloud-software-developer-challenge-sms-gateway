import { DispatchLane } from '@sms/domain/value/dispatch-lane';

/**
 * The one place lane vocabulary meets Kafka vocabulary.
 *
 * `DispatchLane` is a domain concept — "which isolated path does this travel
 * on" — and knows nothing about topics. Everything on the Kafka side needs the
 * translation, so it lives here rather than being spelled out in the publisher,
 * the consumer and the provisioner separately, where the three could drift.
 */

/** A lane's topic, and the value stored in `sms_outbox.type`. */
const TOPICS: Record<string, string> = {
  EXPRESS: 'sms.dispatch.express',
  BULK: 'sms.dispatch.bulk',
  SHARED: 'sms.dispatch.shared',
};

const LANES: Record<string, DispatchLane> = {
  'sms.dispatch.express': DispatchLane.express(),
  'sms.dispatch.bulk': DispatchLane.bulk(),
  'sms.dispatch.shared': DispatchLane.shared(),
};

/**
 * How many partitions each lane gets, which is how consumer capacity is
 * apportioned: a lane can never run more useful consumers than it has
 * partitions.
 *
 * `shared` gets the most despite carrying the least volume per customer, and
 * that is the point. It holds the long tail — tens of thousands of senders
 * hashing across it — so its partition count is what decides how many of them
 * end up behind the same head-of-line block. `bulk` needs fewer because it
 * holds few keys, each of them enormous; adding partitions there would not
 * spread a whale any thinner, since one sender is one key and one key is one
 * partition.
 */
const PARTITIONS: Record<string, number> = {
  'sms.dispatch.express': 6,
  'sms.dispatch.bulk': 6,
  'sms.dispatch.shared': 12,
};

export function topicFor(lane: DispatchLane): string {
  const topic = TOPICS[lane.toString()];
  if (!topic) {
    throw new Error(
      `No topic is configured for dispatch lane ${lane.toString()}.`,
    );
  }
  return topic;
}

/**
 * The reverse, for reading a lane back off an outbox row whose `type` was
 * written by an earlier attempt.
 */
export function laneFor(topic: string): DispatchLane {
  const lane = LANES[topic];
  if (!lane) {
    throw new Error(`No dispatch lane is configured for topic ${topic}.`);
  }
  return lane;
}

export function partitionsFor(topic: string): number {
  return PARTITIONS[topic] ?? 1;
}

export function allTopics(): string[] {
  return Object.values(TOPICS);
}

/**
 * A lane's consumer group. One group per lane, so each lane's workers track
 * their own offsets and a lane that falls behind falls behind alone — which is
 * the isolation the lanes exist for, expressed in the only place Kafka enforces
 * it.
 */
export function consumerGroupFor(lane: DispatchLane): string {
  return `sms-dispatch-${lane.toString().toLowerCase()}`;
}
