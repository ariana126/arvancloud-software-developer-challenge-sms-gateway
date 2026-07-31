import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';

/**
 * The DI token for the shared `Kafka` instance. A class would be the usual
 * token here, but `Kafka` comes from kafkajs and is not ours to decorate, so
 * the connection is provided by factory against a string token instead.
 */
export const KAFKA_CLIENT = 'KAFKA_CLIENT';

/**
 * One `Kafka` per process, shared by the producer, the admin client and the
 * consumer. kafkajs pools connections per instance, so a second one would open
 * a second set of sockets to the same brokers for no benefit.
 *
 * `clientId` carries the role, because it is what shows up in broker logs and
 * in `kafka-consumer-groups.sh` — when a lane is lagging, the first question is
 * which process is behind, and a shared client id makes that unanswerable.
 */
export function createKafkaClient(config: ConfigService, role: string): Kafka {
  const brokers = config
    .getOrThrow<string>('KAFKA_BROKERS')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKERS is set but lists no brokers.');
  }

  return new Kafka({
    clientId: `sms-gateway-${role}`,
    brokers,
    // kafkajs logs at INFO by default and is noisy about routine rebalances.
    // Failures still surface: the producer and consumer both propagate errors
    // to callers that log them with our own logger.
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 5 },
  });
}
