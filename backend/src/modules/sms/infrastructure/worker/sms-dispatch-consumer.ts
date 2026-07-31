import { Clock, EntityNotFound, Identity } from '@framework/domain';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { DispatchLane } from '@sms/domain/value/dispatch-lane';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { ServiceLevel } from '@sms/domain/value/service-level';
import { KAFKA_CLIENT } from '@sms/infrastructure/kafka/kafka-client';
import { consumerGroupFor, topicFor } from '@sms/infrastructure/kafka/topics';
import { Consumer, Kafka } from 'kafkajs';

import { retryBudgetFor } from './dispatch-retry-budget';
import { WORKER_LANE } from './worker-lane.provider';

/** The shape `KafkaSmsDispatchPublisher` writes onto the wire. */
interface DispatchMessage {
  messageId: string;
  senderId: string;
  recipient: string;
  body: string;
  serviceLevel: string;
  sentAt: string;
}

/**
 * One lane's worker: consumes that lane's topic and hands each message to the
 * carrier.
 *
 * **A process runs exactly one lane.** That is the isolation, and it is why the
 * lane is a constructor dependency rather than a loop over three subscriptions:
 * a single process consuming all three would put express messages and a bulk
 * backlog on the same event loop and the same connection pool, which is the
 * arrangement the lanes exist to prevent. Scaling a lane means more replicas of
 * that lane's container, and nothing about the others changes.
 */
@Injectable()
export class SmsDispatchConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SmsDispatchConsumer.name);
  private readonly consumer: Consumer;

  constructor(
    @Inject(KAFKA_CLIENT) kafka: Kafka,
    @Inject(WORKER_LANE) private readonly lane: DispatchLane,
    private readonly provider: SmsProvider,
    private readonly messages: SmsMessageRepository,
    private readonly clock: Clock,
  ) {
    this.consumer = kafka.consumer({ groupId: consumerGroupFor(this.lane) });
  }

  async onApplicationBootstrap(): Promise<void> {
    const topic = topicFor(this.lane);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });
    this.logger.log(`Consuming ${topic} as ${consumerGroupFor(this.lane)}.`);

    // `eachMessage` rather than `eachBatch`: kafkajs commits the offset only
    // after this resolves, so a worker killed mid-delivery leaves the offset
    // where it was and the message is redelivered. That is the at-least-once
    // guarantee the outbox already assumes, and `SmsProvider.deliver` takes a
    // message id so a real carrier can de-duplicate what it produces.
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        await this.handle(
          JSON.parse(message.value.toString()) as DispatchMessage,
        );
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }

  /**
   * Delivers one message and records how it went. **It never throws**, and that
   * is load-bearing: an exception out of `eachMessage` makes kafkajs retry the
   * same offset indefinitely, so one permanently bad message would stop the lane
   * for every message behind it. Everything that can go wrong is turned into a
   * terminal state here instead.
   */
  private async handle(dispatch: DispatchMessage): Promise<void> {
    const messageId = Identity.fromString(dispatch.messageId);
    const budget = retryBudgetFor(this.lane);

    for (let attempt = 1; attempt <= budget.maxAttempts; attempt++) {
      try {
        await this.provider.deliver(
          messageId,
          PhoneNumber.fromString(dispatch.recipient),
          MessageBody.fromString(dispatch.body),
        );
        await this.settle(messageId, (message) => message.markSent());
        this.warnIfLate(dispatch);
        return;
      } catch (error) {
        if (attempt === budget.maxAttempts) {
          this.logger.error(
            `Giving up on SMS ${dispatch.messageId} after ${attempt} carrier attempts on the ${this.lane.toString()} lane. ${this.describe(error)}`,
          );
          await this.settle(messageId, (message) => message.markFailed());
          return;
        }
        await this.pause(budget.backoffInMs * attempt);
      }
    }
  }

  /**
   * Records the outcome, tolerating a message that is no longer there.
   *
   * A missing row is not a bug to propagate. Delivery is at-least-once, so a
   * redelivery can arrive after the message was already settled and cleaned up;
   * and the acceptance suite truncates between scenarios, which makes late
   * arrivals from a previous scenario routine rather than exceptional. Throwing
   * either way would park the lane on an offset it can never get past.
   */
  private async settle(
    messageId: Identity,
    mutate: (message: SmsMessage) => void,
  ): Promise<void> {
    try {
      const message = await this.messages.get(messageId);
      mutate(message);
      await this.messages.save(message);
    } catch (error) {
      if (error instanceof EntityNotFound) {
        this.logger.warn(
          `Delivered SMS ${messageId.asString()} but no such message exists any more; nothing to record.`,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * The express promise, checked against what actually happened.
   *
   * This fails nothing — the message is delivered and the customer was charged
   * either way, and there is no undoing a deadline that has already passed. It
   * exists because **a guarantee nobody measures is a guarantee nobody knows
   * they are breaking**, and this line is the first thing that would show the
   * express lane needing more replicas.
   *
   * The deadline is recomputed here from `sentAt` and the service level rather
   * than read off the message, for the reason nothing persists it: `ServiceLevel`
   * owns the window, and a second copy would be free to disagree. `sentAt` rides
   * on the dispatch precisely so this arithmetic is possible on the far side of
   * the broker without a database read.
   */
  private warnIfLate(dispatch: DispatchMessage): void {
    const deadline = ServiceLevel.fromString(
      dispatch.serviceLevel,
    ).guaranteedDeliveryFrom(new Date(dispatch.sentAt));

    if (!deadline) {
      return;
    }

    const deliveredAt = this.clock.now();
    if (deliveredAt > deadline) {
      this.logger.warn(
        `Express SMS ${dispatch.messageId} reached the carrier at ${deliveredAt.toISOString()}, ` +
          `past its guaranteed ${deadline.toISOString()}. The express lane is not keeping up.`,
      );
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
