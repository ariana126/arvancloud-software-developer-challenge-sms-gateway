import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DispatchLane } from '@sms/domain/value/dispatch-lane';

/** The DI token for "which lane is this worker process responsible for". */
export const WORKER_LANE = 'WORKER_LANE';

/**
 * Reads the one lane this process consumes from `WORKER_LANE`.
 *
 * It **throws on a missing or unrecognised value** rather than defaulting to a
 * lane. A worker that silently picked `SHARED` because of a typo in a Compose
 * file would look healthy while its real lane went unconsumed — the express
 * topic quietly accumulating messages nobody delivers is precisely the failure
 * this whole design exists to prevent, and it should be a boot failure that
 * names itself, not a mystery discovered from a customer complaint.
 */
export const workerLaneProvider: Provider = {
  provide: WORKER_LANE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DispatchLane => {
    const lane = config.get<string>('WORKER_LANE');
    if (!lane) {
      throw new Error(
        'WORKER_LANE is not set; a dispatch worker must be told which lane it consumes (EXPRESS, BULK or SHARED).',
      );
    }
    return DispatchLane.fromString(lane);
  },
};
