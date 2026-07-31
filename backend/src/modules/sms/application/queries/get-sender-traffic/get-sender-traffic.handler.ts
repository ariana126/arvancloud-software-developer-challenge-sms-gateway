import { Clock } from '@framework/domain';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetSenderTrafficQuery } from '@sms/application/queries/get-sender-traffic/get-sender-traffic.query';
import { SenderTrafficReadModel } from '@sms/application/queries/get-sender-traffic/sender-traffic.read-model';
import { SenderTrafficRepository } from '@sms/domain/service/sender-traffic.repository';
import { TrafficPolicy } from '@sms/domain/value/traffic-policy';
import { TrafficTier } from '@sms/domain/value/traffic-tier';

@QueryHandler(GetSenderTrafficQuery)
export class GetSenderTrafficHandler implements IQueryHandler<
  GetSenderTrafficQuery,
  SenderTrafficReadModel
> {
  constructor(
    private readonly senderTraffic: SenderTrafficRepository,
    private readonly policy: TrafficPolicy,
    private readonly clock: Clock,
  ) {}

  /**
   * Reads the count and classifies it **with the same call `SendSmsHandler`
   * makes** — `TrafficTier.forSendCount` against the same injected policy. That
   * is the whole reason the tier is derived rather than stored: this endpoint
   * cannot report a tier that differs from the one the router would choose,
   * because there is only one rule and both callers run it.
   *
   * Reading through the write-side port rather than a dedicated read port is
   * the deviation here, and it is deliberate. This report is one row by primary
   * key with no projection, no ordering and no join; a second adapter over the
   * same table would be two things to keep in step in exchange for nothing.
   */
  async execute(query: GetSenderTrafficQuery): Promise<SenderTrafficReadModel> {
    const snapshot = await this.senderTraffic.findBySender(
      query.senderId,
      this.clock.now(),
      this.policy,
    );
    const tier = TrafficTier.forSendCount(
      snapshot.sendCountInWindow,
      this.policy,
    );

    return new SenderTrafficReadModel(
      tier.toString(),
      snapshot.sendCountInWindow,
      this.policy.getWindowInSeconds(),
      this.policy.getBulkThreshold(),
    );
  }
}
