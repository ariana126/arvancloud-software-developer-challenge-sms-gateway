import { Identity } from '@framework/domain';
import { PrismaService } from '@framework/infrastructure';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SmsDispatch,
  SmsOutboxRepository,
} from '@sms/domain/service/sms-outbox.repository';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { DispatchLane } from '@sms/domain/value/dispatch-lane';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { ServiceLevel } from '@sms/domain/value/service-level';
import { laneFor, topicFor } from '@sms/infrastructure/kafka/topics';

/** How long a claim may go unfinished before someone else may take it over. */
const CLAIM_LEASE_IN_SECONDS = 60;

const OUTBOX_STATUS = {
  pending: 'PENDING',
  inFlight: 'IN_FLIGHT',
  dead: 'DEAD',
} as const;

/** The shape `payload` is written in and read back from. */
interface DispatchPayload {
  messageId: string;
  senderId: string;
  recipient: string;
  body: string;
  serviceLevel: string;
  sentAt: string;
}

interface OutboxRow {
  id: string;
  type: string;
  payload: DispatchPayload;
  attempts: number;
}

@Injectable()
export class PrismaSmsOutboxRepository extends SmsOutboxRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * Written `IN_FLIGHT` rather than `PENDING`, because the request that enqueues
   * it is about to attempt it immediately. A row left claimable in that window
   * would be raced by the relay, and the carrier would see the message twice.
   * If the request dies mid-attempt the claim simply goes stale and
   * `claimAbandoned` takes it over.
   *
   * Goes through `client()`, so this lands inside the caller's transaction —
   * the whole point of an outbox is that this row and the charge commit
   * together.
   *
   * `type` holds the lane's **topic**, which is what the schema comment always
   * said it would: the row records where this dispatch is going, so a relay
   * picking it up after a crash republishes it to the same lane rather than
   * reclassifying a sender whose traffic has moved on since.
   */
  async enqueue(
    message: SmsMessage,
    lane: DispatchLane,
    now: Date,
  ): Promise<SmsDispatch> {
    const payload = this.toPayload(message);

    const row = await this.prisma.client().smsOutbox.create({
      data: {
        type: topicFor(lane),
        payload: payload as unknown as Prisma.InputJsonValue,
        status: OUTBOX_STATUS.inFlight,
        attempts: 1,
        nextAttemptAt: now,
        claimedAt: now,
        createdAt: now,
      },
    });

    return { id: row.id, ...this.toDispatch(payload, lane), attempts: 1 };
  }

  /**
   * Claims due work in **one statement**, which is what makes it safe to run
   * this on every instance at once.
   *
   * `FOR UPDATE SKIP LOCKED` is the load-bearing part: rows another instance has
   * locked in its own claim are stepped over rather than waited for, so N
   * pollers share one queue and no row is ever handed to two of them. Without
   * `SKIP LOCKED` they would serialise behind each other and, worse, each go on
   * to claim the same rows once the lock cleared.
   *
   * Two kinds of row are due — one rescheduled after a failed attempt, and one
   * whose claim has gone stale because whoever held it died mid-dispatch. The
   * second is the crash recovery this whole design exists for.
   *
   * Raw SQL because Prisma has no `FOR UPDATE`. It deliberately does **not** go
   * through `client()`: claiming is the relay's own unit of work and must commit
   * on its own, immediately, rather than joining a caller's transaction.
   */
  async claimAbandoned(limit: number, now: Date): Promise<SmsDispatch[]> {
    const staleBefore = new Date(now.getTime() - CLAIM_LEASE_IN_SECONDS * 1000);

    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE sms_outbox
         SET status = ${OUTBOX_STATUS.inFlight},
             attempts = attempts + 1,
             claimed_at = ${now}
       WHERE id IN (
         SELECT id FROM sms_outbox
          WHERE (status = ${OUTBOX_STATUS.pending} AND next_attempt_at <= ${now})
             OR (status = ${OUTBOX_STATUS.inFlight} AND claimed_at < ${staleBefore})
          ORDER BY created_at
            FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
       )
      RETURNING id, type, payload, attempts;
    `;

    return rows.map((row) => ({
      id: row.id,
      ...this.toDispatch(row.payload, laneFor(row.type)),
      attempts: row.attempts,
    }));
  }

  async settle(id: string): Promise<void> {
    await this.prisma.client().smsOutbox.delete({ where: { id } });
  }

  async reschedule(
    id: string,
    nextAttemptAt: Date,
    error: string,
  ): Promise<void> {
    await this.prisma.client().smsOutbox.update({
      where: { id },
      data: {
        status: OUTBOX_STATUS.pending,
        nextAttemptAt,
        claimedAt: null,
        lastError: error,
      },
    });
  }

  async deadLetter(id: string, error: string): Promise<void> {
    await this.prisma.client().smsOutbox.update({
      where: { id },
      data: {
        status: OUTBOX_STATUS.dead,
        claimedAt: null,
        lastError: error,
      },
    });
  }

  private toPayload(message: SmsMessage): DispatchPayload {
    const primitives = message.toPrimitives() as {
      id: string;
      senderId: string;
      recipient: string;
      body: string;
      serviceLevel: string;
      sentAt: Date;
    };

    return {
      messageId: primitives.id,
      senderId: primitives.senderId,
      recipient: primitives.recipient,
      body: primitives.body,
      serviceLevel: primitives.serviceLevel,
      sentAt: primitives.sentAt.toISOString(),
    };
  }

  /**
   * The lane comes from the row's `type` rather than from the payload, because
   * the topic a row was written for is the fact worth trusting — it is where
   * the message either went or is going. The payload's `serviceLevel` is what
   * the customer bought, which is a different question and is why both are
   * carried.
   */
  private toDispatch(
    payload: DispatchPayload,
    lane: DispatchLane,
  ): Omit<SmsDispatch, 'id' | 'attempts'> {
    return {
      messageId: Identity.fromString(payload.messageId),
      senderId: Identity.fromString(payload.senderId),
      recipient: PhoneNumber.fromString(payload.recipient),
      body: MessageBody.fromString(payload.body),
      serviceLevel: ServiceLevel.fromString(payload.serviceLevel),
      lane,
      sentAt: new Date(payload.sentAt),
    };
  }
}
