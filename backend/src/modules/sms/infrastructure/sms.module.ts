import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { CommandHandlers } from '@sms/application/commands';
import { QueryHandlers } from '@sms/application/queries';
import { SentSmsReportRepository } from '@sms/application/queries/get-sent-sms-report/sent-sms-report.repository';
import { SenderTrafficRepository } from '@sms/domain/service/sender-traffic.repository';
import { SmsDispatchPublisher } from '@sms/domain/service/sms-dispatch-publisher';
import { SmsDispatcher } from '@sms/domain/service/sms-dispatcher';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsOutboxRepository } from '@sms/domain/service/sms-outbox.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { Controllers } from '@sms/infrastructure/http/controllers';

import { createKafkaClient, KAFKA_CLIENT } from './kafka/kafka-client';
import { KafkaSmsDispatchPublisher } from './kafka/kafka-sms-dispatch-publisher';
import { LoggingSmsProvider } from './logging-sms-provider';
import { OutboxSmsDispatcher } from './outbox/outbox-sms-dispatcher';
import { SmsOutboxRelay } from './outbox/sms-outbox-relay';
import { PrismaSenderTrafficRepository } from './persistence/sender-traffic.repository';
import { PrismaSentSmsReportRepository } from './persistence/sent-sms-report.repository';
import { PrismaSmsMessageRepository } from './persistence/sms-message.repository';
import { PrismaSmsOutboxRepository } from './persistence/sms-outbox.repository';
import { trafficPolicyProvider } from './traffic-policy.provider';

/**
 * Note what is *not* imported here: `CreditModule`. `SendSmsHandler` injects
 * `CreditLedger`, but that token comes from `credit/domain/service/` — the
 * published port surface — and the binding is supplied by `CreditModule` being
 * `@Global()`. Importing `credit.module.ts` would be infrastructure reaching
 * into another module's infrastructure, which `modules-isolated` forbids.
 * `UnitOfWork` arrives the same way, from `PrismaModule`.
 */
@Module({
  imports: [CqrsModule],
  controllers: [...Controllers],
  providers: [
    ...CommandHandlers,
    ...QueryHandlers,
    {
      provide: SmsMessageRepository,
      useClass: PrismaSmsMessageRepository,
    },
    // The read side's port. It is bound here rather than beside the write-model
    // repositories in the same breath as `SmsMessageRepository` for a reason
    // worth keeping: its token lives in `application/queries/`, not in
    // `domain/service/`, because nothing outside `sms` reads this report.
    {
      provide: SentSmsReportRepository,
      useClass: PrismaSentSmsReportRepository,
    },
    {
      provide: SmsOutboxRepository,
      useClass: PrismaSmsOutboxRepository,
    },
    {
      provide: SenderTrafficRepository,
      useClass: PrismaSenderTrafficRepository,
    },
    // Where the line between a whale and the long tail is drawn, read from
    // configuration once and injected as a domain value everywhere after.
    trafficPolicyProvider,
    {
      provide: SmsDispatcher,
      useClass: OutboxSmsDispatcher,
    },
    // The connection the producer uses. A factory rather than a class because
    // `Kafka` is kafkajs's type, not one of ours to decorate. Constructing it
    // opens nothing — the producer connects on its first publish.
    {
      provide: KAFKA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createKafkaClient(config, 'api'),
    },
    // **The broker has arrived here.** This binding used to point at
    // `ProviderSmsDispatchPublisher`, which handed the dispatch straight to the
    // carrier in-process; it now produces to the dispatch lane's topic instead.
    // Everything the port's comment promised would survive that swap did: the
    // outbox table, the claim query, the retry policy, the transaction and the
    // whole domain are untouched by it.
    {
      provide: SmsDispatchPublisher,
      useClass: KafkaSmsDispatchPublisher,
    },
    // `SmsProvider` stays bound in this process even though **the API no longer
    // calls it** — the workers are what talk to the carrier now. It is here
    // because `ProviderSmsDispatchPublisher` remains on disk as the broker-free
    // fallback the port documents, and a binding it would need is cheaper to
    // keep than to rediscover.
    {
      provide: SmsProvider,
      useClass: LoggingSmsProvider,
    },
    // Bound to no port: nothing injects the relay, it injects others. It is
    // listed so Nest instantiates it and calls its bootstrap hook, which is what
    // starts the poll loop.
    //
    // **`KafkaTopicProvisioner` is deliberately not here** — it belongs to
    // `SmsDispatchWorkerModule`. Declaring topics from the API would put a
    // broker round trip on its boot path, and this process must start whether or
    // not Kafka is reachable: the outbox is what makes a failed publish
    // recoverable, and an API that will not start cannot accept the sends it
    // would later retry. It is also what keeps `make lint-swagger` and
    // `make generate-swagger` runnable in a throwaway container with nothing
    // else up, exactly as they are for the database.
    SmsOutboxRelay,
  ],
})
export class SmsModule {}
