import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CommandHandlers } from '@sms/application/commands';
import { QueryHandlers } from '@sms/application/queries';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { Controllers } from '@sms/infrastructure/http/controllers';

import { LoggingSmsProvider } from './logging-sms-provider';
import { PrismaSmsMessageRepository } from './persistence/sms-message.repository';

/**
 * Note what is *not* imported here: `CreditModule`. `SendSmsHandler` injects
 * `CreditLedger`, but that token comes from `credit/domain/service/` — the
 * published port surface — and the binding is supplied by `CreditModule` being
 * `@Global()`. Importing `credit.module.ts` would be infrastructure reaching
 * into another module's infrastructure, which `modules-isolated` forbids.
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
    {
      provide: SmsProvider,
      useClass: LoggingSmsProvider,
    },
  ],
})
export class SmsModule {}
