import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Kafka } from 'kafkajs';

import { KAFKA_CLIENT } from './kafka-client';
import { allTopics, partitionsFor } from './topics';

/**
 * Creates the three lane topics at boot, with the partition counts declared in
 * `topics.ts`.
 *
 * Brokers can create topics on demand, and relying on that is the usual reason
 * a lane quietly ends up with one partition: auto-creation uses the broker
 * default, which is a number nobody chose for this workload. Declaring them
 * here makes the counts reviewable in the same file that explains them, and
 * makes a fresh environment identical to an old one.
 *
 * `createTopics` is idempotent — it reports `false` when every topic already
 * existed and changes nothing — so every instance can run this at every boot.
 * It deliberately does **not** shrink or repartition an existing topic: Kafka
 * cannot reduce a partition count, and growing one moves keys to different
 * partitions and breaks per-sender ordering. Changing a count is a migration,
 * not a boot step.
 *
 * **It never fails the boot.** An unreachable broker is logged and stepped over,
 * for the same reason `KafkaSmsDispatchPublisher` connects lazily: an API that
 * refuses to start without Kafka cannot even accept the sends the outbox exists
 * to retry. It is also what keeps `make lint-swagger` and `make generate-swagger`
 * runnable in a throwaway container with nothing else up, exactly as they are for
 * the database.
 */
@Injectable()
export class KafkaTopicProvisioner implements OnApplicationBootstrap {
  private readonly logger = new Logger(KafkaTopicProvisioner.name);

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: Kafka) {}

  async onApplicationBootstrap(): Promise<void> {
    // A far shorter retry budget than the shared client's, because this is the
    // one Kafka call made on the boot path and nothing waits on its result.
    // Compose already orders the broker healthy before the app starts, so a
    // failure here means there is genuinely no broker — and the alternative,
    // inheriting the client's five backing-off retries, adds twenty-odd seconds
    // and a wall of connection errors to `make lint-swagger`, which is expected
    // to run with nothing up at all.
    const admin = this.kafka.admin({
      retry: { retries: 1, initialRetryTime: 100, maxRetryTime: 200 },
    });
    try {
      await admin.connect();

      // Asked for first, rather than letting `createTopics` reject the ones that
      // are already there. It answers `false` either way, but the broker's
      // TOPIC_ALREADY_EXISTS reply is logged as an error by kafkajs's connection
      // layer — an alarming line, at every boot, describing normal operation.
      const existing = new Set(await admin.listTopics());
      const missing = allTopics().filter((topic) => !existing.has(topic));

      if (missing.length === 0) {
        this.logger.log('Dispatch lane topics already exist.');
        return;
      }

      await admin.createTopics({
        waitForLeaders: true,
        topics: missing.map((topic) => ({
          topic,
          numPartitions: partitionsFor(topic),
          replicationFactor: 1,
        })),
      });
      this.logger.log(`Created dispatch lane topics: ${missing.join(', ')}.`);
    } catch (error) {
      this.logger.warn(
        `Could not declare the dispatch lane topics; carrying on without them. Sends will be accepted and left in the outbox until a broker is reachable. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      // A disconnect that fails has nothing left to clean up, and letting it
      // throw here would replace the useful warning above with a useless one.
      await admin.disconnect().catch(() => {
        /* already logged, or never connected */
      });
    }
  }
}
