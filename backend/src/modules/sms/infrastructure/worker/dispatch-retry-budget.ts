import { DispatchLane } from '@sms/domain/value/dispatch-lane';

/**
 * How hard a worker tries before giving up on one message, per lane.
 *
 * A consumer retrying in place **blocks its partition** — every message behind
 * this one waits for it. That makes the retry budget a latency decision rather
 * than a reliability one, and it is why the lanes do not share a budget:
 *
 * - `EXPRESS` retries fast and briefly. It is holding a five-minute promise, and
 *   a message that spends four of those minutes backing off has already broken
 *   it whether or not the fifth attempt works.
 * - `BULK` and `SHARED` can afford to be patient, because nothing behind them is
 *   promised a delivery time. Waiting out a carrier blip is worth more there
 *   than head-of-line latency is.
 *
 * A dead letter topic per lane is the next step if carrier outages ever outlast
 * these budgets — it would move the waiting off the partition entirely. It is
 * deliberately not built yet: it triples the topic count to solve a problem the
 * stand-in carrier cannot yet demonstrate.
 */
export interface RetryBudget {
  readonly maxAttempts: number;
  readonly backoffInMs: number;
}

const EXPRESS: RetryBudget = { maxAttempts: 3, backoffInMs: 200 };
const STANDARD: RetryBudget = { maxAttempts: 5, backoffInMs: 1000 };

export function retryBudgetFor(lane: DispatchLane): RetryBudget {
  return lane.isExpress() ? EXPRESS : STANDARD;
}
