import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { WorkerModule } from './worker.module';

/**
 * A dispatch worker's entry point — the second thing this image can be started
 * as, alongside `main.ts`.
 *
 * `createApplicationContext`, not `create`: there is no HTTP server here and
 * nothing to listen on. The process stays alive because the Kafka consumer
 * holds the event loop open, and its work is driven by messages arriving rather
 * than by requests.
 *
 * `enableShutdownHooks` is what makes SIGTERM orderly. Without it a container
 * stop would kill the process with a message in flight and the consumer still a
 * member of its group, leaving the lane to wait out a session timeout before
 * the partition is reassigned. With it, Nest runs `onModuleDestroy` — the
 * consumer disconnects, leaves the group cleanly, and a rolling restart costs
 * a rebalance instead of a stall.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}
void bootstrap();
