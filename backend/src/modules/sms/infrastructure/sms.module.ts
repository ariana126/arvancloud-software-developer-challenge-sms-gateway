import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CommandHandlers } from '@sms/application/commands';
import { QueryHandlers } from '@sms/application/queries';
import { SentSmsReportRepository } from '@sms/application/queries/get-sent-sms-report/sent-sms-report.repository';
import { SmsDispatchPublisher } from '@sms/domain/service/sms-dispatch-publisher';
import { SmsDispatcher } from '@sms/domain/service/sms-dispatcher';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsOutboxRepository } from '@sms/domain/service/sms-outbox.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { Controllers } from '@sms/infrastructure/http/controllers';

import { LoggingSmsProvider } from './logging-sms-provider';
import { OutboxSmsDispatcher } from './outbox/outbox-sms-dispatcher';
import { ProviderSmsDispatchPublisher } from './outbox/provider-sms-dispatch-publisher';
import { SmsOutboxRelay } from './outbox/sms-outbox-relay';
import { PrismaSentSmsReportRepository } from './persistence/sent-sms-report.repository';
import { PrismaSmsMessageRepository } from './persistence/sms-message.repository';
import { PrismaSmsOutboxRepository } from './persistence/sms-outbox.repository';

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
      provide: SmsDispatcher,
      useClass: OutboxSmsDispatcher,
    },
    // **This binding is where a broker arrives.** Point `SmsDispatchPublisher`
    // at a Kafka producer and dispatch becomes asynchronous, with the outbox,
    // the relay, the retry policy and the whole domain untouched — see the
    // port's own comment.
    {
      provide: SmsDispatchPublisher,
      useClass: ProviderSmsDispatchPublisher,
    },
    {
      provide: SmsProvider,
      useClass: LoggingSmsProvider,
    },
    // Bound to no port: nothing injects the relay, it injects others. It is
    // listed so Nest instantiates it and calls its bootstrap hook, which is what
    // starts the poll loop.
    SmsOutboxRelay,
  ],
})
export class SmsModule {}
