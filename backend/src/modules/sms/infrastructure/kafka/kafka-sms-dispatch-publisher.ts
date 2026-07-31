import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { SmsDispatchPublisher } from '@sms/domain/service/sms-dispatch-publisher';
import { SmsDispatch } from '@sms/domain/service/sms-outbox.repository';
import { Kafka, Partitioners, Producer } from 'kafkajs';

import { KAFKA_CLIENT } from './kafka-client';
import { topicFor } from './topics';

/**
 * Publishes a dispatch onto its lane's topic. This is the broker arriving —
 * the implementation `SmsDispatchPublisher` was written as a seam for.
 *
 * Two choices here carry the whole design:
 *
 * **The topic is the lane.** Isolation is not a priority number attached to a
 * message in one shared queue; it is a different queue, with its own
 * partitions, its own consumer group and its own workers. A backlog on
 * `sms.dispatch.bulk` is invisible to a consumer of `sms.dispatch.express`,
 * which is the only reason the express delivery guarantee is worth making.
 *
 * **The key is the sender.** Kafka guarantees order within a partition and
 * assigns partitions by hashing the key, so keying on `senderId` gives every
 * customer a stable partition and its messages a stable order relative to each
 * other. Keying on the *message* id instead would spread one customer's traffic
 * across every partition and lose that ordering for nothing.
 *
 * That key is also the reason lanes and keys are not interchangeable, and the
 * reason both are needed: a key spreads senders evenly but cannot stop a single
 * enormous sender from filling the partition it lands on, along with everyone
 * else hashed there. Moving that sender to another topic is what stops it.
 *
 * **Not an idempotent producer**, deliberately. Kafka's idempotent producer
 * wants unlimited retries and warns that a bounded retry count invalidates the
 * guarantee it offers — so with the bounded retries this client sets, enabling
 * it would buy a warning rather than a property. Nothing is lost by that,
 * because de-duplication already lives a layer out: delivery here is documented
 * as at-least-once, the outbox is what makes a redelivered dispatch harmless,
 * and `SmsProvider.deliver` takes the message id precisely so a real carrier can
 * de-duplicate on it.
 */
@Injectable()
export class KafkaSmsDispatchPublisher
  extends SmsDispatchPublisher
  implements OnModuleDestroy
{
  private readonly producer: Producer;
  private connected: Promise<void> | null = null;

  constructor(@Inject(KAFKA_CLIENT) kafka: Kafka) {
    super();
    this.producer = kafka.producer({
      // Named explicitly rather than left to default, which silences kafkajs's
      // v2 migration warning. This is the modern default and the one we want:
      // it hashes the key, which is what puts a sender on a stable partition.
      createPartitioner: Partitioners.DefaultPartitioner,
      // The topics are declared at boot by `KafkaTopicProvisioner`; a publish to
      // a topic that does not exist is a misconfiguration and should say so
      // rather than quietly conjure a one-partition topic.
      allowAutoTopicCreation: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
    }
  }

  /**
   * Connects on first publish rather than at boot, and remembers the promise so
   * concurrent sends share one connection attempt instead of racing to open
   * several.
   *
   * **Lazy on purpose: the API must not need the broker in order to start.** An
   * unreachable Kafka at boot would otherwise take the whole HTTP server down
   * with it, which is precisely backwards — the outbox exists so that a publish
   * can fail and be retried, and an API that cannot start cannot even accept
   * the sends it would later retry. It also keeps `make lint-swagger` and
   * `make generate-swagger` honest: both boot the app in a throwaway container
   * with nothing else running, exactly as they do for the database.
   *
   * A failed attempt is not cached — `connected` is cleared, so the next publish
   * tries again rather than being stuck with a rejected promise forever.
   */
  private connect(): Promise<void> {
    const existing = this.connected;
    if (existing) {
      return existing;
    }

    const attempt = this.producer.connect().catch((error: unknown) => {
      this.connected = null;
      throw error;
    });
    this.connected = attempt;
    return attempt;
  }

  /**
   * Throws when the broker will not take the message — deliberately. The caller
   * is `OutboxSmsDispatcher`, whose whole job is to turn that into a rescheduled
   * outbox row, and the row is what makes the send recoverable. Swallowing the
   * failure here would settle a dispatch that never left the building.
   *
   * `acks: -1` waits for every in-sync replica. A dispatch that has been paid
   * for should not be lost to a broker failing seconds after acknowledging it,
   * and the latency this costs is spent once per message on a path that is
   * already asynchronous.
   */
  public async publish(dispatch: SmsDispatch): Promise<void> {
    await this.connect();
    await this.producer.send({
      topic: topicFor(dispatch.lane),
      acks: -1,
      messages: [
        {
          key: dispatch.senderId.asString(),
          value: JSON.stringify({
            messageId: dispatch.messageId.asString(),
            senderId: dispatch.senderId.asString(),
            recipient: dispatch.recipient.asString(),
            body: dispatch.body.asString(),
            serviceLevel: dispatch.serviceLevel.toString(),
            sentAt: dispatch.sentAt.toISOString(),
          }),
          headers: {
            // Read by nothing today. They are here because a lagging lane is
            // diagnosed by peeking at a partition, and a payload that says
            // which attempt and which level it is answers the two questions
            // anyone actually has at that moment.
            'x-service-level': dispatch.serviceLevel.toString(),
            'x-attempt': String(dispatch.attempts),
          },
        },
      ],
    });
  }
}
