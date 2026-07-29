import { DomainEvent } from '@framework/domain';

export class CreditDecreased implements DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly amount: number,
  ) {}
}
