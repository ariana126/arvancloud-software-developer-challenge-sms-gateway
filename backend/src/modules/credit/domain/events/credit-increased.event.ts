import { DomainEvent } from '@framework/domain';

export class CreditIncreased implements DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly amount: number,
  ) {}
}
