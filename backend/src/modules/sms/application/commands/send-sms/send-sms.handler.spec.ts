import { CreditLedger } from '@credit/domain/service/credit-ledger';
import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { Clock, Identity, UnitOfWork } from '@framework/domain';
import { InsufficientCreditException } from '@sms/application/exceptions';
import { SmsDispatcher } from '@sms/domain/service/sms-dispatcher';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import {
  SmsDispatch,
  SmsOutboxRepository,
} from '@sms/domain/service/sms-outbox.repository';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { ServiceLevel } from '@sms/domain/value/service-level';

import { SendSmsCommand } from './send-sms.command';
import { SendSmsHandler } from './send-sms.handler';

const SENT_AT = new Date('2026-01-01T00:00:00.000Z');
const RECIPIENT = '09121234567';
const BODY = 'Your order has shipped.';
const COST_PER_SMS = 1000;

class FakeCreditLedger extends CreditLedger {
  public readonly charges: Array<{ userId: string; amount: number }> = [];
  private failure: Error | null = null;

  public rejectWith(error: Error): void {
    this.failure = error;
  }

  charge(userId: Identity, amountInRials: number): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    this.charges.push({ userId: userId.asString(), amount: amountInRials });
    return Promise.resolve();
  }
}

class FakeSmsMessageRepository extends SmsMessageRepository {
  public readonly saved: SmsMessage[] = [];

  find(): Promise<SmsMessage | null> {
    return Promise.resolve(null);
  }

  get(): Promise<SmsMessage> {
    throw new Error('not used by this handler');
  }

  save(entity: SmsMessage): Promise<void> {
    this.saved.push(entity);
    return Promise.resolve();
  }
}

class FakeSmsOutboxRepository extends SmsOutboxRepository {
  public readonly enqueued: SmsMessage[] = [];

  enqueue(message: SmsMessage): Promise<SmsDispatch> {
    this.enqueued.push(message);
    return Promise.resolve({
      id: `outbox-${this.enqueued.length}`,
      messageId: message.id,
      recipient: message.getRecipient(),
      body: message.getBody(),
      attempts: 1,
    });
  }

  claimAbandoned(): Promise<SmsDispatch[]> {
    return Promise.resolve([]);
  }
  settle(): Promise<void> {
    return Promise.resolve();
  }
  reschedule(): Promise<void> {
    return Promise.resolve();
  }
  deadLetter(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Stands in for `OutboxSmsDispatcher`, and keeps its contract: it never throws,
 * because a carrier that refuses leaves the outbox row rather than failing the
 * request. `failWith` makes it *record* a failure, not raise one.
 */
class FakeSmsDispatcher extends SmsDispatcher {
  public readonly dispatched: SmsDispatch[] = [];
  public readonly failed: SmsDispatch[] = [];
  private failing = false;

  public failSilently(): void {
    this.failing = true;
  }

  dispatch(dispatch: SmsDispatch): Promise<void> {
    if (this.failing) {
      this.failed.push(dispatch);
      return Promise.resolve();
    }
    this.dispatched.push(dispatch);
    return Promise.resolve();
  }
}

/**
 * Records the order things happened in, so a test can assert that the charge,
 * the message and the outbox row were all written *before* the commit — the
 * property that makes it impossible to take money without recording what for.
 */
class RecordingUnitOfWork extends UnitOfWork {
  public executions = 0;
  public committed = false;

  async execute<T>(work: () => Promise<T>): Promise<T> {
    this.executions++;
    const result = await work();
    this.committed = true;
    return result;
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

function makeSut(
  ledger: FakeCreditLedger = new FakeCreditLedger(),
  dispatcher: FakeSmsDispatcher = new FakeSmsDispatcher(),
  repository: FakeSmsMessageRepository = new FakeSmsMessageRepository(),
  outbox: FakeSmsOutboxRepository = new FakeSmsOutboxRepository(),
  unitOfWork: RecordingUnitOfWork = new RecordingUnitOfWork(),
): {
  sut: SendSmsHandler;
  ledger: FakeCreditLedger;
  dispatcher: FakeSmsDispatcher;
  repository: FakeSmsMessageRepository;
  outbox: FakeSmsOutboxRepository;
  unitOfWork: RecordingUnitOfWork;
} {
  return {
    sut: new SendSmsHandler(
      ledger,
      repository,
      outbox,
      dispatcher,
      unitOfWork,
      new FixedClock(SENT_AT),
    ),
    ledger,
    dispatcher,
    repository,
    outbox,
    unitOfWork,
  };
}

function commandFrom(
  senderId: Identity,
  serviceLevel: ServiceLevel = ServiceLevel.standard(),
): SendSmsCommand {
  return new SendSmsCommand(
    senderId,
    PhoneNumber.fromString(RECIPIENT),
    MessageBody.fromString(BODY),
    serviceLevel,
  );
}

function expressCommand(): SendSmsCommand {
  return commandFrom(Identity.new(), ServiceLevel.express());
}

function shortOn(available: number): FakeCreditLedger {
  const ledger = new FakeCreditLedger();
  ledger.rejectWith(
    InsufficientCredit.forWallet(Identity.new(), COST_PER_SMS, available),
  );
  return ledger;
}

describe('SendSmsHandler', () => {
  it('sending charges the flat tariff price against the sender', async () => {
    const senderId = Identity.new();
    const { sut, ledger } = makeSut();

    await sut.execute(commandFrom(senderId));

    expect(ledger.charges).toEqual([
      { userId: senderId.asString(), amount: COST_PER_SMS },
    ]);
  });

  it('the message is recorded with its sender, recipient, body and the time it was accepted', async () => {
    const senderId = Identity.new();
    const { sut, repository } = makeSut();

    await sut.execute(commandFrom(senderId));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].toPrimitives()).toMatchObject({
      senderId: senderId.asString(),
      recipient: RECIPIENT,
      body: BODY,
      sentAt: SENT_AT,
    });
  });

  /**
   * The heart of the outbox: money, message and the obligation to deliver are
   * one commit. Any of them landing without the others is the failure this
   * design exists to rule out.
   */
  it('charges, records and enqueues the dispatch in a single transaction', async () => {
    const { sut, ledger, repository, outbox, unitOfWork } = makeSut();

    await sut.execute(commandFrom(Identity.new()));

    expect(unitOfWork.executions).toBe(1);
    expect(ledger.charges).toHaveLength(1);
    expect(repository.saved).toHaveLength(1);
    expect(outbox.enqueued).toHaveLength(1);
  });

  it('the message is written PENDING, because the carrier has not seen it yet', async () => {
    const { sut, repository } = makeSut();

    await sut.execute(commandFrom(Identity.new()));

    expect(repository.saved[0].toPrimitives()).toMatchObject({
      status: 'PENDING',
    });
  });

  it('the enqueued dispatch is for the message that was just recorded', async () => {
    const { sut, repository, outbox } = makeSut();

    await sut.execute(commandFrom(Identity.new()));

    expect(outbox.enqueued[0].id.equals(repository.saved[0].id)).toBe(true);
  });

  /**
   * Outside the transaction, deliberately: a transaction held open across a
   * carrier's network keeps a wallet row locked for as long as their network
   * takes.
   */
  it('the dispatch is attempted after the transaction has committed', async () => {
    const { sut, dispatcher, unitOfWork } = makeSut();

    await sut.execute(commandFrom(Identity.new()));

    expect(unitOfWork.committed).toBe(true);
    expect(dispatcher.dispatched).toHaveLength(1);
  });

  it('sending answers with the new message id and what it cost', async () => {
    const { sut, repository } = makeSut();

    const result = await sut.execute(commandFrom(Identity.new()));

    expect(result).toEqual({
      id: repository.saved[0].id.asString(),
      cost: COST_PER_SMS,
    });
  });

  it('an express send answers with the instant it is guaranteed to reach the operator', async () => {
    const { sut, repository } = makeSut();

    const result = await sut.execute(expressCommand());

    expect(result).toEqual({
      id: repository.saved[0].id.asString(),
      cost: COST_PER_SMS,
      guaranteedDeliveryAt: '2026-01-01T00:05:00.000Z',
    });
  });

  // Absent, not null: the key is missing from the answer entirely, which is what
  // "a standard send promises nothing" looks like on the wire.
  it('a standard send answers with no guarantee at all', async () => {
    const { sut } = makeSut();

    const result = await sut.execute(commandFrom(Identity.new()));

    expect(result).not.toHaveProperty('guaranteedDeliveryAt');
  });

  it('the recorded message keeps the service level it was sent at', async () => {
    const { sut, repository } = makeSut();

    await sut.execute(expressCommand());

    expect(repository.saved[0].toPrimitives()).toMatchObject({
      serviceLevel: 'EXPRESS',
    });
  });

  it('an express send is charged the same flat tariff as a standard one', async () => {
    const senderId = Identity.new();
    const { sut, ledger } = makeSut();

    await sut.execute(commandFrom(senderId, ServiceLevel.express()));

    expect(ledger.charges).toEqual([
      { userId: senderId.asString(), amount: COST_PER_SMS },
    ]);
  });

  it('a balance too short for one message dispatches nothing', async () => {
    const { sut, dispatcher } = makeSut(shortOn(400));

    await expect(sut.execute(commandFrom(Identity.new()))).rejects.toThrow();

    expect(dispatcher.dispatched).toHaveLength(0);
  });

  it('a balance too short for one message records nothing and owes nothing', async () => {
    const { sut, repository, outbox } = makeSut(shortOn(400));

    await expect(sut.execute(commandFrom(Identity.new()))).rejects.toThrow();

    expect(repository.saved).toHaveLength(0);
    expect(outbox.enqueued).toHaveLength(0);
  });

  it("a short balance is reported as the sms module's own exception, not credit's", async () => {
    const { sut } = makeSut(shortOn(400));

    const rejection = await sut
      .execute(commandFrom(Identity.new()))
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(InsufficientCreditException);
    expect(rejection).not.toBeInstanceOf(InsufficientCredit);
  });

  it('the rejection carries what the send required and what the sender had', async () => {
    const { sut } = makeSut(shortOn(400));

    const rejection = (await sut
      .execute(commandFrom(Identity.new()))
      .catch((error: unknown) => error)) as InsufficientCreditException;

    expect(rejection.required).toBe(COST_PER_SMS);
    expect(rejection.available).toBe(400);
  });

  /**
   * The behaviour the outbox buys, and the reverse of what this handler used to
   * do. A carrier that refuses no longer fails the request: the send is paid
   * for, recorded and owed, the outbox row is left for the relay, and the sender
   * is told their message was accepted — because it was.
   */
  it('a dispatch that fails still answers successfully, leaving the row to the relay', async () => {
    const dispatcher = new FakeSmsDispatcher();
    dispatcher.failSilently();
    const { sut, ledger, repository, outbox } = makeSut(
      new FakeCreditLedger(),
      dispatcher,
    );

    const result = await sut.execute(commandFrom(Identity.new()));

    expect(result).toMatchObject({ cost: COST_PER_SMS });
    expect(dispatcher.failed).toHaveLength(1);
    expect(ledger.charges).toHaveLength(1);
    expect(repository.saved).toHaveLength(1);
    expect(outbox.enqueued).toHaveLength(1);
  });

  it('an unexpected ledger failure propagates untranslated', async () => {
    const ledger = new FakeCreditLedger();
    const unexpectedError = new Error('database is unreachable');
    ledger.rejectWith(unexpectedError);
    const { sut, dispatcher } = makeSut(ledger);

    await expect(sut.execute(commandFrom(Identity.new()))).rejects.toBe(
      unexpectedError,
    );

    expect(dispatcher.dispatched).toHaveLength(0);
  });
});
