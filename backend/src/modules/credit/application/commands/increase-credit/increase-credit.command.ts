import { Money } from '@credit/domain/value/money';
import { Identity } from '@framework/domain';

export class IncreaseCreditCommand {
  constructor(
    public readonly userId: Identity,
    public readonly amount: Money,
  ) {}
}
