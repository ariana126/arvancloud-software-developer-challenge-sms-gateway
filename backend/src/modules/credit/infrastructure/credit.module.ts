import { CommandHandlers } from '@credit/application/commands';
import { QueryHandlers } from '@credit/application/queries';
import { WalletRepository } from '@credit/domain/service/wallet.repository';
import { Controllers } from '@credit/infrastructure/http/controllers';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { PrismaWalletRepository } from './persistence/wallet.repository';

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
  ],
  exports: [WalletRepository],
})
export class CreditModule {}
