import { ValueObject } from '@framework/domain';

/**
 * Where the line between a high-volume sender and the long tail is drawn.
 *
 * These two numbers are operational, not eternal — the right threshold depends
 * on how much capacity the shared lane has today — so they are configuration
 * rather than constants. Wrapping them in a value object is what keeps that
 * configuration out of the domain: `TrafficTier` is handed a policy and asks it
 * a question, instead of reading a `ConfigService` it must not know about.
 *
 * The window is expressed in seconds because that is the unit the counter's
 * rollover arithmetic uses; nothing here converts.
 */
export class TrafficPolicy extends ValueObject {
  private constructor(
    private readonly bulkThreshold: number,
    private readonly windowInSeconds: number,
  ) {
    super();
  }

  /**
   * `bulkThreshold` is the number of sends *within* the window above which a
   * sender is treated as high volume; `windowInSeconds` is how far back that
   * count reaches.
   */
  static of(bulkThreshold: number, windowInSeconds: number): TrafficPolicy {
    if (!Number.isInteger(bulkThreshold) || bulkThreshold < 1) {
      throw new Error(
        `Bulk tier threshold must be a positive integer, got: ${bulkThreshold}.`,
      );
    }
    if (!Number.isInteger(windowInSeconds) || windowInSeconds < 1) {
      throw new Error(
        `Traffic window must be a positive whole number of seconds, got: ${windowInSeconds}.`,
      );
    }
    return new TrafficPolicy(bulkThreshold, windowInSeconds);
  }

  /**
   * Whether a sender that has sent this many messages in the current window is
   * a high-volume one. Strictly greater than, so a threshold of 1000 means the
   * thousandth send is still ordinary traffic and the thousand-and-first is not.
   */
  public isBulk(sendCount: number): boolean {
    return sendCount > this.bulkThreshold;
  }

  public getBulkThreshold(): number {
    return this.bulkThreshold;
  }

  public getWindowInSeconds(): number {
    return this.windowInSeconds;
  }

  /** The instant before which a window is stale and the next send rolls it over. */
  public windowExpiredBefore(now: Date): Date {
    return new Date(now.getTime() - this.windowInSeconds * 1000);
  }
}
