import { DispatchLane } from '@sms/domain/value/dispatch-lane';

import {
  allTopics,
  consumerGroupFor,
  laneFor,
  partitionsFor,
  topicFor,
} from './topics';

describe('dispatch lane topics', () => {
  it('gives every lane a topic of its own', () => {
    const topics = [
      topicFor(DispatchLane.express()),
      topicFor(DispatchLane.bulk()),
      topicFor(DispatchLane.shared()),
    ];

    expect(new Set(topics).size).toBe(3);
    expect(topics).toEqual([
      'sms.dispatch.express',
      'sms.dispatch.bulk',
      'sms.dispatch.shared',
    ]);
  });

  /**
   * An outbox row records its topic, and a relay picking that row up after a
   * crash has to get the same lane back out of it — otherwise a retry could be
   * republished onto a lane the message was never classified into.
   */
  it.each([DispatchLane.express(), DispatchLane.bulk(), DispatchLane.shared()])(
    'round-trips %s through its topic',
    (lane) => {
      expect(laneFor(topicFor(lane)).toString()).toBe(lane.toString());
    },
  );

  it('refuses a topic that belongs to no lane', () => {
    expect(() => laneFor('sms.dispatch.requested')).toThrow(
      'No dispatch lane is configured for topic sms.dispatch.requested.',
    );
  });

  /**
   * The shared lane holds tens of thousands of senders and needs the most
   * partitions to keep them from queueing behind each other; the bulk lane
   * holds a handful of enormous keys, and more partitions would not spread one
   * sender any thinner.
   */
  it('gives the shared lane the most partitions', () => {
    const shared = partitionsFor(topicFor(DispatchLane.shared()));

    expect(shared).toBeGreaterThan(
      partitionsFor(topicFor(DispatchLane.bulk())),
    );
    expect(shared).toBeGreaterThan(
      partitionsFor(topicFor(DispatchLane.express())),
    );
  });

  it('declares every lane topic for provisioning', () => {
    expect(allTopics()).toHaveLength(3);
    expect(allTopics()).toContain(topicFor(DispatchLane.express()));
  });

  /**
   * One consumer group per lane is where Kafka actually enforces the isolation:
   * offsets are tracked per group, so a lane that falls behind falls behind
   * alone.
   */
  it('gives every lane a consumer group of its own', () => {
    const groups = [
      consumerGroupFor(DispatchLane.express()),
      consumerGroupFor(DispatchLane.bulk()),
      consumerGroupFor(DispatchLane.shared()),
    ];

    expect(new Set(groups).size).toBe(3);
    expect(groups[0]).toBe('sms-dispatch-express');
  });
});
