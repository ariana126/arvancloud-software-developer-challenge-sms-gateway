import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';

import { createKafkaClient, KAFKA_CLIENT } from './kafka/kafka-client';
import { KafkaTopicProvisioner } from './kafka/kafka-topic-provisioner';
import { LoggingSmsProvider } from './logging-sms-provider';
import { PrismaSmsMessageRepository } from './persistence/sms-message.repository';
import { SmsDispatchConsumer } from './worker/sms-dispatch-consumer';
import { workerLaneProvider } from './worker/worker-lane.provider';

/**
 * The consuming half of the SMS module, and deliberately **not** `SmsModule`.
 *
 * A worker needs a carrier, a way to record what the carrier said, and a
 * consumer. It does not need controllers, the CQRS buses, the credit ledger,
 * the outbox relay or the producer — importing `SmsModule` to get three
 * providers would drag all of that into every worker container and start a poll
 * loop in three processes that have no business running one.
 *
 * The duplication that costs is two bindings repeated from `SmsModule`
 * (`SmsProvider`, `SmsMessageRepository`) and a second `KAFKA_CLIENT` factory.
 * That is the price of the two halves being separately deployable, which is the
 * entire point: the express worker scales without scaling the API.
 */
@Module({
  // Only for the `EventBus` that `PrismaEntityRepository` publishes an aggregate's
  // events through on save — `markSent` records `SmsSent`, so a worker saving a
  // message needs somewhere to put it. Nothing in this process subscribes, and
  // nothing should: a worker is not where in-process event handlers belong. It is
  // here as a dependency of the repository base class, not as a bus this module uses.
  imports: [CqrsModule],
  providers: [
    {
      provide: SmsMessageRepository,
      useClass: PrismaSmsMessageRepository,
    },
    {
      provide: SmsProvider,
      useClass: LoggingSmsProvider,
    },
    // The client id says `worker` rather than `api`, because a lagging lane is
    // diagnosed by asking the broker which client is behind.
    {
      provide: KAFKA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createKafkaClient(config, 'worker'),
    },
    workerLaneProvider,
    // Declaring the lane topics is the workers' job, not the API's. A worker
    // cannot do anything at all without a reachable broker, so a broker round
    // trip on *its* boot path costs nothing — where the same call on the API's
    // would stop it accepting sends the outbox exists to retry.
    KafkaTopicProvisioner,
    SmsDispatchConsumer,
  ],
})
export class SmsDispatchWorkerModule {}
