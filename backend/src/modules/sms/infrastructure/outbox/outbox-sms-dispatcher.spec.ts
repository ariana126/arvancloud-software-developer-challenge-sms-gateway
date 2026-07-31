import { Clock, Identity, UnitOfWork } from '@framework/domain';
import { SmsDispatchPublisher } from '@sms/domain/service/sms-dispatch-publisher';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import {
  SmsDispatch,
  SmsOutboxRepository,
} from '@sms/domain/service/sms-outbox.repository';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { ServiceLevel } from '@sms/domain/value/service-level';

import { OutboxSmsDispatcher } from './outbox-sms-dispatcher';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const MAX_ATTEMPTS = 5;

class FakePublisher extends SmsDispatchPublisher {
  public readonly published: SmsDispatch[] = [];
  private failure: Error | null = null;

  public failWith(error: Error): void {
    this.failure = error;
  }

  publish(dispatch: SmsDispatch): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    this.published.push(dispatch);
    return Promise.resolve();
  }
}

class FakeOutbox extends SmsOutboxRepository {
  public readonly settled: string[] = [];
  public readonly rescheduled: Array<{
    id: string;
    nextAttemptAt: Date;
    error: string;
  }> = [];
  public readonly deadLettered: Array<{ id: string; error: string }> = [];
  private settleFailure: Error | null = null;

  public failToSettleWith(error: Error): void {
    this.settleFailure = error;
  }

  enqueue(): Promise<SmsDispatch> {
    throw new Error('not used by the dispatcher');
  }
  claimAbandoned(): Promise<SmsDispatch[]> {
    return Promise.resolve([]);
  }
  settle(id: string): Promise<void> {
    if (this.settleFailure) {
      return Promise.reject(this.settleFailure);
    }
    this.settled.push(id);
    return Promise.resolve();
  }
  reschedule(id: string, nextAttemptAt: Date, error: string): Promise<void> {
    this.rescheduled.push({ id, nextAttemptAt, error });
    return Promise.resolve();
  }
  deadLetter(id: string, error: string): Promise<void> {
    this.deadLettered.push({ id, error });
    return Promise.resolve();
  }
}

class FakeMessages extends SmsMessageRepository {
  public readonly saved: SmsMessage[] = [];

  constructor(private readonly message: SmsMessage) {
    super();
  }

  find(): Promise<SmsMessage | null> {
    return Promise.resolve(this.message);
  }
  get(): Promise<SmsMessage> {
    return Promise.resolve(this.message);
  }
  save(entity: SmsMessage): Promise<void> {
    this.saved.push(entity);
    return Promise.resolve();
  }
}

class ImmediateUnitOfWork extends UnitOfWork {
  execute<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class FixedClock extends Clock {
  now(): Date {
    return NOW;
  }
}

function aMessage(): SmsMessage {
  return SmsMessage.queue(
    Identity.new(),
    PhoneNumber.fromString('09121234567'),
    MessageBody.fromString('Your order has shipped.'),
    ServiceLevel.standard(),
    NOW,
  );
}

function makeSut(attempts = 1): {
  sut: OutboxSmsDispatcher;
  publisher: FakePublisher;
  outbox: FakeOutbox;
  messages: FakeMessages;
  message: SmsMessage;
  dispatch: SmsDispatch;
} {
  const message = aMessage();
  const publisher = new FakePublisher();
  const outbox = new FakeOutbox();
  const messages = new FakeMessages(message);

  return {
    sut: new OutboxSmsDispatcher(
      publisher,
      outbox,
      messages,
      new ImmediateUnitOfWork(),
      new FixedClock(),
    ),
    publisher,
    outbox,
    messages,
    message,
    dispatch: {
      id: 'outbox-1',
      messageId: message.id,
      recipient: message.getRecipient(),
      body: message.getBody(),
      attempts,
    },
  };
}

describe('OutboxSmsDispatcher', () => {
  it('publishes the dispatch to the carrier', async () => {
    const { sut, publisher, dispatch } = makeSut();

    await sut.dispatch(dispatch);

    expect(publisher.published).toEqual([dispatch]);
  });

  it('clears the outbox row once the carrier has taken it', async () => {
    const { sut, outbox, dispatch } = makeSut();

    await sut.dispatch(dispatch);

    expect(outbox.settled).toEqual(['outbox-1']);
  });

  it('marks the message sent once the carrier has taken it', async () => {
    const { sut, messages, dispatch } = makeSut();

    await sut.dispatch(dispatch);

    expect(messages.saved).toHaveLength(1);
    expect(messages.saved[0].isSent()).toBe(true);
  });

  it('reschedules a refused dispatch instead of losing it', async () => {
    const { sut, publisher, outbox, dispatch } = makeSut();
    publisher.failWith(new Error('carrier is unreachable'));

    await sut.dispatch(dispatch);

    expect(outbox.rescheduled).toHaveLength(1);
    expect(outbox.settled).toHaveLength(0);
  });

  it('records why the dispatch was refused, for whoever reads the row', async () => {
    const { sut, publisher, outbox, dispatch } = makeSut();
    publisher.failWith(new Error('carrier is unreachable'));

    await sut.dispatch(dispatch);

    expect(outbox.rescheduled[0].error).toBe('carrier is unreachable');
  });

  /** 2s, then 4, 8, 16 — long enough to outlast a blip, short enough to matter. */
  it('backs off exponentially with each attempt', async () => {
    const delays: number[] = [];

    for (const attempts of [1, 2, 3, 4]) {
      const { sut, publisher, outbox, dispatch } = makeSut(attempts);
      publisher.failWith(new Error('carrier is unreachable'));

      await sut.dispatch(dispatch);

      delays.push(
        outbox.rescheduled[0].nextAttemptAt.getTime() - NOW.getTime(),
      );
    }

    expect(delays).toEqual([2000, 4000, 8000, 16_000]);
  });

  it('leaves the message PENDING while it is still being retried', async () => {
    const { sut, publisher, messages, dispatch } = makeSut();
    publisher.failWith(new Error('carrier is unreachable'));

    await sut.dispatch(dispatch);

    expect(messages.saved).toHaveLength(0);
  });

  it('dead-letters the row once the attempts are exhausted', async () => {
    const { sut, publisher, outbox, dispatch } = makeSut(MAX_ATTEMPTS);
    publisher.failWith(new Error('carrier is unreachable'));

    await sut.dispatch(dispatch);

    expect(outbox.deadLettered).toEqual([
      { id: 'outbox-1', error: 'carrier is unreachable' },
    ]);
    expect(outbox.rescheduled).toHaveLength(0);
  });

  it('marks the message FAILED when it gives up, so no report calls it sent', async () => {
    const { sut, publisher, messages, dispatch } = makeSut(MAX_ATTEMPTS);
    publisher.failWith(new Error('carrier is unreachable'));

    await sut.dispatch(dispatch);

    expect(messages.saved).toHaveLength(1);
    expect(messages.saved[0].toPrimitives()).toMatchObject({
      status: 'FAILED',
    });
  });

  /**
   * The deliberate policy: reimbursing from the same code path that has just
   * failed five times is how a bug becomes money. An operator refunds through
   * the existing top-up endpoint, working from the dead-lettered row.
   */
  it('refunds nothing when it gives up — that is a decision for a person', async () => {
    const { sut, publisher, dispatch } = makeSut(MAX_ATTEMPTS);
    publisher.failWith(new Error('carrier is unreachable'));

    // There is no ledger among its dependencies at all, which is the strongest
    // form this assertion can take: it *cannot* refund.
    await sut.dispatch(dispatch);

    expect(
      Object.values(sut).some(
        (dependency) =>
          dependency !== null &&
          typeof dependency === 'object' &&
          'charge' in dependency,
      ),
    ).toBe(false);
  });

  /**
   * Its contract, and what lets `SendSmsHandler` answer 201 regardless: the
   * outbox row is the record of what is owed, so there is nobody to propagate a
   * failure to who could do anything better with it.
   */
  it('never throws, whatever the carrier does', async () => {
    const { sut, publisher, dispatch } = makeSut();
    publisher.failWith(new Error('carrier is unreachable'));

    await expect(sut.dispatch(dispatch)).resolves.toBeUndefined();
  });

  /**
   * At-least-once, made visible: the carrier has the message but the row could
   * not be cleared, so it will be attempted again. This is exactly why
   * `SmsProvider.deliver` is handed a message id to de-duplicate on.
   */
  it('survives a delivered message whose row cannot be settled', async () => {
    const { sut, outbox, dispatch } = makeSut();
    outbox.failToSettleWith(new Error('connection lost'));

    await expect(sut.dispatch(dispatch)).resolves.toBeUndefined();

    expect(outbox.deadLettered).toHaveLength(0);
    expect(outbox.rescheduled).toHaveLength(0);
  });
});
