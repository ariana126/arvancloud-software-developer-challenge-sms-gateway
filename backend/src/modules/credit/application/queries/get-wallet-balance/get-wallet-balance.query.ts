import { Identity } from '@framework/domain';

export class GetWalletBalanceQuery {
  constructor(public readonly userId: Identity) {}
}
