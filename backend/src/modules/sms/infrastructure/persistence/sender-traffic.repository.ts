import { Identity } from '@framework/domain';
import { PrismaService } from '@framework/infrastructure';
import { Injectable } from '@nestjs/common';
import {
  SenderTrafficRepository,
  SenderTrafficSnapshot,
} from '@sms/domain/service/sender-traffic.repository';
import { TrafficPolicy } from '@sms/domain/value/traffic-policy';

interface TrafficRow {
  send_count: number;
  window_started_at: Date;
}

@Injectable()
export class PrismaSenderTrafficRepository extends SenderTrafficRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * Counts the send and rolls the window over in **one statement**, for the same
   * reason `PrismaWalletRepository` debits with a guarded delta rather than
   * writing a balance it read a moment ago: the alternative loses increments
   * under concurrency, and it loses them fastest for the senders whose counts
   * matter most.
   *
   * The two `CASE` expressions are the rollover. If the stored window opened
   * before `expiredBefore`, it has aged out and this send starts a fresh one at
   * `now` with a count of 1; otherwise the window stands and the count goes up
   * by one. Doing it inside the upsert is what lets an expired window cost
   * nothing — there is no sweeper, no cron, and an idle sender's stale row is
   * simply corrected by whatever send eventually arrives.
   *
   * Raw SQL because this is a conditional `ON CONFLICT` update that Prisma's
   * `upsert` cannot express: `update` there takes values, not expressions over
   * the existing row. It goes through `client()`, so it joins the send's
   * transaction and a rolled-back send does not leave a phantom message counted
   * against its sender.
   */
  async recordSend(
    senderId: Identity,
    now: Date,
    policy: TrafficPolicy,
  ): Promise<SenderTrafficSnapshot> {
    const expiredBefore = policy.windowExpiredBefore(now);

    const rows = await this.prisma.client().$queryRaw<TrafficRow[]>`
      INSERT INTO sms_sender_traffic (sender_id, window_started_at, send_count)
      VALUES (${senderId.asString()}, ${now}, 1)
      ON CONFLICT (sender_id) DO UPDATE SET
        window_started_at = CASE
          WHEN sms_sender_traffic.window_started_at <= ${expiredBefore}
          THEN ${now}
          ELSE sms_sender_traffic.window_started_at
        END,
        send_count = CASE
          WHEN sms_sender_traffic.window_started_at <= ${expiredBefore}
          THEN 1
          ELSE sms_sender_traffic.send_count + 1
        END
      RETURNING send_count, window_started_at;
    `;

    const row = rows[0];
    return {
      sendCountInWindow: row.send_count,
      windowStartedAt: row.window_started_at,
    };
  }

  /**
   * The read side, which must apply the same expiry the write side does — a row
   * whose window closed while its sender was idle describes traffic that is no
   * longer being offered, and reporting its stale count would keep a customer
   * looking like a whale long after it stopped being one.
   *
   * Expiry is evaluated here rather than in SQL because this is a read: a query
   * that corrected the row would be a write, and a report is not entitled to
   * one.
   */
  async findBySender(
    senderId: Identity,
    now: Date,
    policy: TrafficPolicy,
  ): Promise<SenderTrafficSnapshot> {
    const row = await this.prisma.smsSenderTraffic.findUnique({
      where: { senderId: senderId.asString() },
    });

    const expiredBefore = policy.windowExpiredBefore(now);
    if (!row || row.windowStartedAt <= expiredBefore) {
      return { sendCountInWindow: 0, windowStartedAt: now };
    }

    return {
      sendCountInWindow: row.sendCount,
      windowStartedAt: row.windowStartedAt,
    };
  }
}
