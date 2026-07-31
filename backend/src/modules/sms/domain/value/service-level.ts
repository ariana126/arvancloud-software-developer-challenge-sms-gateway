import { ValueObject } from '@framework/domain';

/**
 * How quickly a message is promised to reach the operator. Express costs the
 * same as standard — it buys a promise, not a different price, so the tariff
 * knows nothing about this type.
 *
 * The promise itself is the only thing that distinguishes the two levels, which
 * is why it is asked of the level rather than read off it: callers ask for the
 * guarantee and get one or get nothing, instead of asking which level this is
 * and doing the arithmetic themselves.
 */
export class ServiceLevel extends ValueObject {
  private static readonly STANDARD = 'STANDARD';
  private static readonly EXPRESS = 'EXPRESS';

  /**
   * The single place the express promise is written down. Nothing outside this
   * class knows the number, and no persisted row repeats it — see
   * `guaranteedDeliveryFrom`.
   */
  private static readonly EXPRESS_DELIVERY_WINDOW_IN_MINUTES = 5;

  private constructor(private readonly code: string) {
    super();
  }

  static standard(): ServiceLevel {
    return new ServiceLevel(ServiceLevel.STANDARD);
  }

  static express(): ServiceLevel {
    return new ServiceLevel(ServiceLevel.EXPRESS);
  }

  /**
   * Rebuilds a level from its stored code. Unlike `SmsStatus`, this type really
   * does have two values, so reconstructing one means reading it back rather
   * than assuming it.
   */
  static fromString(code: string): ServiceLevel {
    const normalized = code.trim().toUpperCase();
    if (normalized === ServiceLevel.STANDARD) {
      return ServiceLevel.standard();
    }
    if (normalized === ServiceLevel.EXPRESS) {
      return ServiceLevel.express();
    }
    throw new Error(`Unknown service level: ${code}`);
  }

  /**
   * The instant by which a message sent at `sentAt` is guaranteed to reach the
   * operator, or nothing at all when the level makes no such promise. A standard
   * send has no deadline — that absence is the meaning, so it is expressed by
   * there being no value rather than by a null or a sentinel date.
   *
   * The instant is derived from the one supplied, never from the machine clock,
   * so it is exactly as deterministic as the `Clock` the caller read. It is also
   * why nothing persists it: a stored deadline would be a second copy of the
   * window above, free to disagree with it. The trade that accepts is that
   * changing the window changes what past messages report; the day the promise
   * made at send time has to outlive a change to the promise, it earns a column.
   */
  public guaranteedDeliveryFrom(sentAt: Date): Date | undefined {
    if (!this.isExpress()) {
      return undefined;
    }
    return new Date(
      sentAt.getTime() +
        ServiceLevel.EXPRESS_DELIVERY_WINDOW_IN_MINUTES * 60 * 1000,
    );
  }

  /**
   * Whether this level promises anything about delivery time at all.
   *
   * Phrased as the promise rather than as `isExpress` for the same reason
   * `guaranteedDeliveryFrom` is: callers care that there is a guarantee to keep,
   * not which of two names the level goes by. `DispatchLane.for` is the caller
   * that needed it — a guaranteed message earns the isolated lane, and it earns
   * it by being guaranteed rather than by being called express.
   */
  public guaranteesDelivery(): boolean {
    return this.isExpress();
  }

  private isExpress(): boolean {
    return this.code === ServiceLevel.EXPRESS;
  }

  toString(): string {
    return this.code;
  }
}
