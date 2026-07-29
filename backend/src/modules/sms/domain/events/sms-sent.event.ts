import { DomainEvent } from '@framework/domain';

export class SmsSent implements DomainEvent {
  constructor(
    public readonly messageId: string,
    public readonly senderId: string,
    public readonly recipient: string,
    public readonly sentAt: Date,
  ) {}
}
