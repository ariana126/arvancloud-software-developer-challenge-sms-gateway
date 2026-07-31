import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
 * **It fails the boot when it cannot finish, and it runs on `onModuleInit`.**
 * Both of those are load-bearing, and both were learned the hard way.
 *
 * The hook is `onModuleInit` rather than `onApplicationBootstrap` because Nest
 * runs every `onApplicationBootstrap` in a module *concurrently* —
 * `await Promise.all(...)` in `@nestjs/core/hooks/on-app-bootstrap.hook.js` —
 * so declaring this before `SmsDispatchConsumer` in the module's `providers`
 * ordered nothing. `consumer.subscribe()` won the race against `createTopics`,
 * asked the broker for metadata on a topic that did not exist yet, and with
 * `KAFKA_AUTO_CREATE_TOPICS_ENABLE=false` was answered
 * `UNKNOWN_TOPIC_OR_PARTITION` — which killed the worker and took this
 * half-finished provisioner down with it, so no topics were ever created. Nest
 * awaits *all* `onModuleInit` hooks before *any* `onApplicationBootstrap`, and
 * that is the only ordering guarantee on offer here.
 *
 * And it throws, where it used to warn and carry on. That leniency was written
 * for an API that provisioned its own topics: an API must start without a
 * broker, because it has an outbox to accept sends into and retry from. This
 * class is **worker-only** (`sms.module.ts` says so explicitly), and a worker
 * without its topic can do nothing at all — a lane that looks up and consumes
 * nothing is the exact outage the lanes exist to prevent. Failing loudly plus
 * `restart: unless-stopped` in Compose is what makes a cold start self-heal.
 */
@Injectable()
export class KafkaTopicProvisioner implements OnModuleInit {
  private readonly logger = new Logger(KafkaTopicProvisioner.name);

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: Kafka) {}

  async onModuleInit(): Promise<void> {
    // The shared client's budget — five attempts, backing off — rather than the
    // single retry this used to take. It is now the gate the consumer waits
    // behind, so it is worth a broker that is still settling; the short budget
    // was there to keep `make lint-swagger` quick, and that command never
    // constructs this class.
    const admin = this.kafka.admin();
    try {
      await admin.connect();

      // Asked for first, rather than letting `createTopics` reject the ones that
      // are already there. It answers `false` either way, but the broker's
      // TOPIC_ALREADY_EXISTS reply is logged as an error by kafkajs's connection
      // layer — an alarming line, at every boot, describing normal operation.
      const missing = await this.missingFrom(admin);

      if (missing.length === 0) {
        this.logger.log('Dispatch lane topics already exist.');
        return;
      }

      try {
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
        // Three workers boot at once and all three declare all three topics, so
        // losing this race is routine rather than exceptional. What matters is
        // not who created the topic but whether it is there now, which is what
        // the verification below asks — and it asks the broker rather than
        // pattern-matching on an error code.
        this.logger.warn(
          `Declaring the dispatch lane topics did not complete; checking whether another worker got there first. ${this.describe(error)}`,
        );
      }

      const stillMissing = await this.missingFrom(admin);
      if (stillMissing.length > 0) {
        throw new Error(
          `The dispatch lane topics ${stillMissing.join(', ')} do not exist and could not be created. A worker cannot consume a lane that has no topic.`,
        );
      }
    } finally {
      // A disconnect that fails has nothing left to clean up, and letting it
      // throw here would replace the real reason for the failure with a useless
      // one.
      await admin.disconnect().catch(() => {
        /* already failing, or never connected */
      });
    }
  }

  private async missingFrom(
    admin: ReturnType<Kafka['admin']>,
  ): Promise<string[]> {
    const existing = new Set(await admin.listTopics());
    return allTopics().filter((topic) => !existing.has(topic));
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
