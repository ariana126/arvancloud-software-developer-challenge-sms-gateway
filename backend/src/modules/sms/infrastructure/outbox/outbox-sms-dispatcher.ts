import { Clock, UnitOfWork } from '@framework/domain';
import { Injectable, Logger } from '@nestjs/common';
import { SmsDispatchPublisher } from '@sms/domain/service/sms-dispatch-publisher';
import { SmsDispatcher } from '@sms/domain/service/sms-dispatcher';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import {
  SmsDispatch,
  SmsOutboxRepository,
} from '@sms/domain/service/sms-outbox.repository';

/** How many times a dispatch is attempted before we stop trying. */
const MAX_ATTEMPTS = 5;

/** First retry after 2s, then 4, 8, 16 — long enough to outlast a blip. */
const BACKOFF_BASE_IN_SECONDS = 1;

@Injectable()
export class OutboxSmsDispatcher extends SmsDispatcher {
  private readonly logger = new Logger(OutboxSmsDispatcher.name);

  constructor(
    private readonly publisher: SmsDispatchPublisher,
    private readonly outbox: SmsOutboxRepository,
    private readonly messages: SmsMessageRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {
    super();
  }

  /**
   * Publish, then settle — and never throw, whichever way it goes. The outbox
   * row is the record of what is still owed, so a failure here means the row
   * lives on and is attempted again; there is nobody to propagate to who could
   * do anything better with it.
   *
   * Clearing the row and marking the message sent are one transaction, so the
   * two can never disagree. What is *not* in that transaction is the publish
   * itself, deliberately: holding a transaction open across a call to a carrier
   * would keep a row locked for as long as somebody else's network takes.
   *
   * The consequence is at-least-once delivery — a publish that succeeds and a
   * settle that fails leaves the row to be dispatched again — which is what
   * `SmsProvider.deliver` takes a message id for.
   */
  public async dispatch(dispatch: SmsDispatch): Promise<void> {
    try {
      await this.publisher.publish(dispatch);
    } catch (error) {
      await this.retryOrGiveUp(dispatch, error);
      return;
    }

    try {
      await this.unitOfWork.execute(async () => {
        await this.outbox.settle(dispatch.id);
        await this.markSent(dispatch);
      });
    } catch (error) {
      // The carrier has the message; only the bookkeeping failed. Left alone,
      // the claim goes stale and the relay reclaims the row — which is why the
      // provider is handed an idempotency key.
      this.logger.error(
        `Delivered SMS ${dispatch.messageId.asString()} but could not settle its outbox row; it will be retried. ${this.describe(error)}`,
      );
    }
  }

  private async markSent(dispatch: SmsDispatch): Promise<void> {
    const message = await this.messages.get(dispatch.messageId);
    message.markSent();
    await this.messages.save(message);
  }

  /**
   * Backs off, and eventually stops.
   *
   * On exhaustion the row is dead-lettered and the message marked `FAILED`, in
   * one transaction — **and the credit is deliberately not refunded**. A dead
   * letter is a decision for a person, not for a retry loop that has already
   * demonstrated it cannot get this message out; automatic reimbursement from
   * the same code path that just failed repeatedly is how a bug turns into
   * money. The affordance for putting it right already exists: an operator tops
   * the sender back up through `POST /api/credit/increase`.
   */
  private async retryOrGiveUp(
    dispatch: SmsDispatch,
    error: unknown,
  ): Promise<void> {
    const reason = this.describe(error);

    if (dispatch.attempts >= MAX_ATTEMPTS) {
      this.logger.error(
        `Giving up on SMS ${dispatch.messageId.asString()} after ${dispatch.attempts} attempts; dead-lettering it. ${reason}`,
      );
      await this.unitOfWork.execute(async () => {
        await this.outbox.deadLetter(dispatch.id, reason);
        await this.markFailed(dispatch);
      });
      return;
    }

    const delayInSeconds = BACKOFF_BASE_IN_SECONDS * 2 ** dispatch.attempts;
    const nextAttemptAt = new Date(
      this.clock.now().getTime() + delayInSeconds * 1000,
    );

    this.logger.warn(
      `Could not deliver SMS ${dispatch.messageId.asString()} (attempt ${dispatch.attempts}); retrying in ${delayInSeconds}s. ${reason}`,
    );
    await this.outbox.reschedule(dispatch.id, nextAttemptAt, reason);
  }

  private async markFailed(dispatch: SmsDispatch): Promise<void> {
    const message = await this.messages.get(dispatch.messageId);
    message.markFailed();
    await this.messages.save(message);
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
