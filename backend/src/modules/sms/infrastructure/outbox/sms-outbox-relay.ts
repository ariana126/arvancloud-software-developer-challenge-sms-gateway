import { Clock } from '@framework/domain';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsDispatcher } from '@sms/domain/service/sms-dispatcher';
import { SmsOutboxRepository } from '@sms/domain/service/sms-outbox.repository';

const POLL_INTERVAL_IN_MS = 2000;
const BATCH_SIZE = 20;

/**
 * The safety net behind the outbox: it picks up dispatches nobody finished.
 *
 * In the normal case it finds nothing, because the request that accepted the
 * send dispatched it inline and cleared the row. What reaches this loop is what
 * went wrong — a carrier that refused the message, a request that died between
 * the commit and the dispatch, a process killed mid-attempt. Those are exactly
 * the cases where a charge would otherwise have been taken for a message nobody
 * ever tried again.
 *
 * Running it on every instance is safe and intended: the claim is a single
 * statement using `FOR UPDATE SKIP LOCKED`, so pollers share the queue instead
 * of colliding over it.
 *
 * **Ticks never overlap.** The interval schedules the *next* tick only once the
 * current one has finished, so a slow carrier cannot have the loop claiming a
 * second batch while the first is still in flight.
 */
@Injectable()
export class SmsOutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SmsOutboxRelay.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly outbox: SmsOutboxRepository,
    private readonly dispatcher: SmsDispatcher,
    private readonly clock: Clock,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.isEnabled()) {
      this.logger.log(
        'Outbox relay disabled (OUTBOX_RELAY_ENABLED=false); dispatches will only be attempted in-request.',
      );
      return;
    }
    this.scheduleNextTick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Off in the acceptance test stack. A poller running against a database the
   * suite truncates between scenarios is a flake generator with nothing to
   * catch — the suite cannot make the stand-in carrier fail, so this loop would
   * never have work to do there.
   */
  private isEnabled(): boolean {
    return this.config.get<string>('OUTBOX_RELAY_ENABLED') !== 'false';
  }

  private scheduleNextTick(): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNextTick());
    }, POLL_INTERVAL_IN_MS);
    // Nothing here should hold the process open at shutdown.
    this.timer.unref?.();
  }

  /**
   * One sweep. It swallows its own failures on purpose: a poller that dies on a
   * transient database error stops recovering anything, forever, and the rows it
   * would have picked up are the ones a user has already paid for.
   */
  private async tick(): Promise<void> {
    try {
      const due = await this.outbox.claimAbandoned(
        BATCH_SIZE,
        this.clock.now(),
      );

      for (const dispatch of due) {
        // Sequential, not `Promise.all`: a batch is unfinished work being
        // retried, and hammering a carrier that has just been failing is the
        // wrong instinct. `SmsDispatcher.dispatch` never throws, so one bad
        // dispatch cannot abandon the rest of the batch.
        await this.dispatcher.dispatch(dispatch);
      }
    } catch (error) {
      this.logger.error(
        `Outbox relay sweep failed; retrying on the next tick. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
