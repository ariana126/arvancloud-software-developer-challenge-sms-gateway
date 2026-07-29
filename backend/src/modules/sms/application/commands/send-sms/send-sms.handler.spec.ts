import { CreditLedger } from '@credit/domain/service/credit-ledger';
import { InsufficientCredit } from '@credit/domain/service/insufficient-credit.exception';
import { Clock, Identity } from '@framework/domain';
import { InsufficientCreditException } from '@sms/application/exceptions';
import { SmsMessageRepository } from '@sms/domain/service/sms-message.repository';
import { SmsProvider } from '@sms/domain/service/sms-provider';
import { SmsMessage } from '@sms/domain/sms-message.aggregate';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';

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

class FakeSmsProvider extends SmsProvider {
  public readonly delivered: Array<{ recipient: string; body: string }> = [];
  private failure: Error | null = null;

  public failWith(error: Error): void {
    this.failure = error;
  }

  deliver(recipient: PhoneNumber, body: MessageBody): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    this.delivered.push({
      recipient: recipient.asString(),
      body: body.asString(),
    });
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
  provider: FakeSmsProvider = new FakeSmsProvider(),
  repository: FakeSmsMessageRepository = new FakeSmsMessageRepository(),
): {
  sut: SendSmsHandler;
  ledger: FakeCreditLedger;
  provider: FakeSmsProvider;
  repository: FakeSmsMessageRepository;
} {
  return {
    sut: new SendSmsHandler(
      ledger,
      provider,
      repository,
      new FixedClock(SENT_AT),
    ),
    ledger,
    provider,
    repository,
  };
}

function commandFrom(senderId: Identity): SendSmsCommand {
  return new SendSmsCommand(
    senderId,
    PhoneNumber.fromString(RECIPIENT),
    MessageBody.fromString(BODY),
  );
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

  it('the message is dispatched to the recipient with the given body', async () => {
    const { sut, provider } = makeSut();

    await sut.execute(commandFrom(Identity.new()));

    expect(provider.delivered).toEqual([{ recipient: RECIPIENT, body: BODY }]);
  });

  it('the sent message is recorded with its sender, recipient, body and the time it was sent', async () => {
    const senderId = Identity.new();
    const { sut, repository } = makeSut();

    await sut.execute(commandFrom(senderId));

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].toPrimitives()).toMatchObject({
      senderId: senderId.asString(),
      recipient: RECIPIENT,
      body: BODY,
      status: 'SENT',
      sentAt: SENT_AT,
    });
  });

  it('sending answers with the new message id and what it cost', async () => {
    const { sut, repository } = makeSut();

    const result = await sut.execute(commandFrom(Identity.new()));

    expect(result).toEqual({
      id: repository.saved[0].id.asString(),
      cost: COST_PER_SMS,
    });
  });

  it('a balance too short for one message dispatches nothing', async () => {
    const { sut, provider } = makeSut(shortOn(400));

    await expect(sut.execute(commandFrom(Identity.new()))).rejects.toThrow();

    expect(provider.delivered).toHaveLength(0);
  });

  it('a balance too short for one message records nothing', async () => {
    const { sut, repository } = makeSut(shortOn(400));

    await expect(sut.execute(commandFrom(Identity.new()))).rejects.toThrow();

    expect(repository.saved).toHaveLength(0);
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

  // The no-refund trade, asserted rather than assumed: charging first is what
  // stops an unaffordable message being dispatched, and the price of that order
  // is that a provider failure leaves the sender charged for nothing. If a
  // refund path is ever added, this test is the one that should fail first.
  it('a provider failure records nothing, and the charge deliberately stands', async () => {
    const provider = new FakeSmsProvider();
    const providerFailure = new Error('provider is unreachable');
    provider.failWith(providerFailure);
    const { sut, ledger, repository } = makeSut(
      new FakeCreditLedger(),
      provider,
    );

    await expect(sut.execute(commandFrom(Identity.new()))).rejects.toBe(
      providerFailure,
    );

    expect(repository.saved).toHaveLength(0);
    expect(ledger.charges).toHaveLength(1);
  });

  it('an unexpected ledger failure propagates untranslated', async () => {
    const ledger = new FakeCreditLedger();
    const unexpectedError = new Error('database is unreachable');
    ledger.rejectWith(unexpectedError);
    const { sut, provider } = makeSut(ledger);

    await expect(sut.execute(commandFrom(Identity.new()))).rejects.toBe(
      unexpectedError,
    );

    expect(provider.delivered).toHaveLength(0);
  });
});
