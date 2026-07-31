import { Clock, EntityNotFound, Identity } from '@framework/domain';
import { Logger } from '@nestjs/common';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { DispatchLane } from '@sms/domain/value/dispatch-lane';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { ServiceLevel } from '@sms/domain/value/service-level';
import { Kafka } from 'kafkajs';

import { SmsDispatchConsumer } from './sms-dispatch-consumer';

const SENT_AT = new Date('2026-01-01T00:00:00.000Z');
const RECIPIENT = '09121234567';
const BODY = 'Your order has shipped.';

type EachMessage = (payload: {
  message: { value: Buffer | null };
}) => Promise<void>;

/**
 * Stands in for kafkajs, capturing the `eachMessage` callback so a test can
 * deliver a message by hand. Driving the consumer through its real
 * `onApplicationBootstrap` rather than calling a private method keeps the JSON
 * decoding and the subscription in the test's reach.
 */
class FakeKafka {
  public eachMessage: EachMessage | null = null;
  public subscribedTo: string | null = null;
  public groupId: string | null = null;

  consumer({ groupId }: { groupId: string }) {
    this.groupId = groupId;
    return {
      connect: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      subscribe: ({ topic }: { topic: string }) => {
        this.subscribedTo = topic;
        return Promise.resolve();
      },
      run: ({ eachMessage }: { eachMessage: EachMessage }) => {
        this.eachMessage = eachMessage;
        return Promise.resolve();
      },
    };
  }
}

class FakeSmsProvider extends SmsProvider {
  public delivered: string[] = [];
  private failuresLeft = 0;

  public failFor(attempts: number): void {
    this.failuresLeft = attempts;
  }

  deliver(messageId: Identity): Promise<void> {
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      return Promise.reject(new Error('carrier is unreachable'));
    }
    this.delivered.push(messageId.asString());
    return Promise.resolve();
  }
}

class FakeSmsMessageRepository extends SmsMessageRepository {
  public readonly saved: SmsMessage[] = [];
  private missing = false;

  constructor(private readonly message: SmsMessage) {
    super();
  }

  public loseTheMessage(): void {
    this.missing = true;
  }

  find(): Promise<SmsMessage | null> {
    return Promise.resolve(this.missing ? null : this.message);
  }

  get(id: Identity): Promise<SmsMessage> {
    if (this.missing) {
      return Promise.reject(EntityNotFound.withId(id));
    }
    return Promise.resolve(this.message);
  }

  save(entity: SmsMessage): Promise<void> {
    this.saved.push(entity);
    return Promise.resolve();
  }
}

class FixedClock extends Clock {
  constructor(private readonly instant: Date) {
    super();
  }

  now(): Date {
    return this.instant;
  }
}

function aQueuedMessage(): SmsMessage {
  const message = SmsMessage.queue(
    Identity.new(),
    PhoneNumber.fromString(RECIPIENT),
    MessageBody.fromString(BODY),
    ServiceLevel.standard(),
    SENT_AT,
  );
  message.markQueued();
  return message;
}

async function makeSut(
  lane: DispatchLane = DispatchLane.shared(),
  deliveredAt: Date = SENT_AT,
) {
  const message = aQueuedMessage();
  const kafka = new FakeKafka();
  const provider = new FakeSmsProvider();
  const messages = new FakeSmsMessageRepository(message);
  const logged: string[] = [];

  const sut = new SmsDispatchConsumer(
    kafka as unknown as Kafka,
    lane,
    provider,
    messages,
    new FixedClock(deliveredAt),
  );
  jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation((entry: unknown) => logged.push(String(entry)));
  await sut.onApplicationBootstrap();

  const deliver = async (serviceLevel = 'STANDARD'): Promise<void> => {
    await kafka.eachMessage!({
      message: {
        value: Buffer.from(
          JSON.stringify({
            messageId: message.id.asString(),
            senderId: Identity.new().asString(),
            recipient: RECIPIENT,
            body: BODY,
            serviceLevel,
            sentAt: SENT_AT.toISOString(),
          }),
        ),
      },
    });
  };

  return { sut, kafka, provider, messages, message, deliver, logged };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SmsDispatchConsumer', () => {
  it('consumes only the lane it was given', async () => {
    const { kafka } = await makeSut(DispatchLane.express());

    expect(kafka.subscribedTo).toBe('sms.dispatch.express');
    expect(kafka.groupId).toBe('sms-dispatch-express');
  });

  it('hands the message to the carrier', async () => {
    const { provider, message, deliver } = await makeSut();

    await deliver();

    expect(provider.delivered).toEqual([message.id.asString()]);
  });

  /**
   * The other half of the state the broker made necessary: the outbox marked
   * this `QUEUED` when Kafka acknowledged it, and only now — with a carrier
   * that has actually taken it — does it become `SENT` and appear in the
   * sender's report.
   */
  it('marks the message sent once the carrier has taken it', async () => {
    const { messages, deliver } = await makeSut();

    await deliver();

    expect(messages.saved).toHaveLength(1);
    expect(messages.saved[0].isSent()).toBe(true);
  });

  it('retries a refused delivery before giving up on it', async () => {
    const { provider, messages, message, deliver } = await makeSut(
      DispatchLane.express(),
    );
    provider.failFor(2);

    await deliver();

    expect(provider.delivered).toEqual([message.id.asString()]);
    expect(messages.saved[0].isSent()).toBe(true);
  });

  /**
   * Express retries three times with a short backoff, which is why this test
   * costs a few hundred milliseconds rather than the ten seconds the standard
   * budget would. The budget is a latency decision: a consumer retrying in place
   * blocks its partition, and express is holding a five-minute promise.
   */
  it('marks the message failed once the retry budget is spent', async () => {
    const { provider, messages, deliver } = await makeSut(
      DispatchLane.express(),
    );
    provider.failFor(99);

    await deliver();

    expect(provider.delivered).toHaveLength(0);
    expect(messages.saved).toHaveLength(1);
    expect(messages.saved[0].toPrimitives()).toMatchObject({
      status: 'FAILED',
    });
  });

  /**
   * Delivery is at-least-once, so a redelivery can arrive after the message was
   * already settled and cleaned up. Throwing here would make kafkajs retry the
   * same offset forever and park the whole lane behind one dead message.
   */
  it('tolerates a message that no longer exists', async () => {
    const { messages, deliver } = await makeSut();
    messages.loseTheMessage();

    await expect(deliver()).resolves.toBeUndefined();

    expect(messages.saved).toHaveLength(0);
  });

  /**
   * The express guarantee, measured. Nothing fails — the message is delivered
   * and was charged for either way — but a promise nobody measures is a promise
   * nobody knows they are breaking, and this is the line that would show the
   * express lane needing more replicas.
   */
  it('says so when an express message misses its guarantee', async () => {
    const sixMinutesLater = new Date(SENT_AT.getTime() + 6 * 60 * 1000);
    const { deliver, logged } = await makeSut(
      DispatchLane.express(),
      sixMinutesLater,
    );

    await deliver('EXPRESS');

    expect(logged.join('\n')).toMatch(/past its guaranteed/);
  });

  it('stays quiet when an express message arrives inside its guarantee', async () => {
    const oneMinuteLater = new Date(SENT_AT.getTime() + 60 * 1000);
    const { deliver, logged } = await makeSut(
      DispatchLane.express(),
      oneMinuteLater,
    );

    await deliver('EXPRESS');

    expect(logged).toHaveLength(0);
  });

  /** A standard send promises no delivery time, so there is nothing to miss. */
  it('never reports a standard send as late', async () => {
    const muchLater = new Date(SENT_AT.getTime() + 24 * 60 * 60 * 1000);
    const { deliver, logged } = await makeSut(DispatchLane.shared(), muchLater);

    await deliver('STANDARD');

    expect(logged).toHaveLength(0);
  });

  it('ignores a message with no payload', async () => {
    const { kafka, provider } = await makeSut();

    await kafka.eachMessage!({ message: { value: null } });

    expect(provider.delivered).toHaveLength(0);
  });
});
