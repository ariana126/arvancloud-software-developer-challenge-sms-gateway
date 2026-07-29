import { CommandHandlers } from '@credit/application/commands';
import { QueryHandlers } from '@credit/application/queries';
import { CreditLedger } from '@credit/domain/service/credit-ledger';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Controllers } from '@credit/infrastructure/http/controllers';
import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { PrismaWalletRepository } from './persistence/wallet.repository';
import { WalletCreditLedger } from './wallet-credit-ledger';

/**
 * `@Global()` so another module can inject the exported `CreditLedger` without
 * importing this one — `sms.module.ts` importing `credit.module.ts` would be
 * infrastructure reaching into infrastructure, which `modules-isolated`
 * forbids. A consumer names only the `CreditLedger` token from
 * `credit/domain/service/`, which is the published surface. `AuthModule` and
 * `ClockModule` are the precedent.
 */
@Global()
@Module({
  imports: [CqrsModule],
  controllers: [...Controllers],
  providers: [
    ...CommandHandlers,
    ...QueryHandlers,
    {
      provide: WalletRepository,
      useClass: PrismaWalletRepository,
    },
    {
      provide: CreditLedger,
      useClass: WalletCreditLedger,
    },
  ],
  exports: [WalletRepository, CreditLedger],
})
export class CreditModule {}
