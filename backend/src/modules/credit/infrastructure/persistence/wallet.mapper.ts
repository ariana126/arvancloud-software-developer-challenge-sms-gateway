import { Money } from '@credit/domain/value/money';
import { Wallet } from '@credit/domain/wallet.aggregate';
import { Identity } from '@framework/domain';
import { Wallet as PrismaWallet } from '@prisma/client';

export class WalletMapper {
  public static toDomain(prismaWallet: PrismaWallet): Wallet {
    return new Wallet(
      Identity.fromString(prismaWallet.id),
      Money.rials(prismaWallet.balance),
    );
  }

  public static toPersistence(wallet: Wallet): PrismaWallet {
    return wallet.toPrimitives() as PrismaWallet;
  }
}
