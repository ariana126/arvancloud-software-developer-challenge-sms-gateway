import { Identity } from '@framework/domain';

import { GetSentSmsReportHandler } from './get-sent-sms-report.handler';
import { GetSentSmsReportQuery } from './get-sent-sms-report.query';
import {
  SentSmsRecord,
  SentSmsReportRepository,
} from './sent-sms-report.repository';

/**
 * A small in-memory store keyed by sender, rather than a stub that returns a
 * fixed list. That is what lets "a user's report shows only their own sends" be
 * asserted as **output** — seed two senders, read one back — instead of as an
 * interaction on a stub, which asserts a means rather than an end and breaks on
 * any refactor that keeps the behaviour.
 */
class FakeSentSmsReportRepository extends SentSmsReportRepository {
  private readonly bySender = new Map<string, SentSmsRecord[]>();

  public store(senderId: Identity, record: SentSmsRecord): void {
    const sent = this.bySender.get(senderId.asString()) ?? [];
    sent.push(record);
    this.bySender.set(senderId.asString(), sent);
  }

  public findBySender(senderId: Identity): Promise<SentSmsRecord[]> {
    return Promise.resolve(this.bySender.get(senderId.asString()) ?? []);
  }
}

describe('GetSentSmsReportHandler', () => {
  const SENT_AT = new Date('2026-01-01T00:00:00.000Z');

  const aSentSms = (overrides: Partial<SentSmsRecord> = {}): SentSmsRecord => ({
    id: '550e8400-e29b-41d4-a716-446655440000',
    recipient: '09121234567',
    message: 'Your order has shipped.',
    status: 'SENT',
    serviceLevel: 'STANDARD',
    sentAt: SENT_AT,
    ...overrides,
  });

  it('a sender who has sent nothing has an empty report', async () => {
    const sut = new GetSentSmsReportHandler(new FakeSentSmsReportRepository());

    const report = await sut.execute(new GetSentSmsReportQuery(Identity.new()));

    expect(report).toEqual([]);
  });

  it('the report shows the recipient and the message of a sent SMS', async () => {
    const senderId = Identity.new();
    const repository = new FakeSentSmsReportRepository();
    repository.store(
      senderId,
      aSentSms({ recipient: '09129876543', message: 'Your parcel is here.' }),
    );
    const sut = new GetSentSmsReportHandler(repository);

    const report = await sut.execute(new GetSentSmsReportQuery(senderId));

    expect(report).toEqual([
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        recipient: '09129876543',
        message: 'Your parcel is here.',
        status: 'SENT',
        serviceLevel: 'STANDARD',
        cost: 1000,
        sentAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('the report names the service level a message was sent at', async () => {
    const senderId = Identity.new();
    const repository = new FakeSentSmsReportRepository();
    repository.store(senderId, aSentSms({ serviceLevel: 'EXPRESS' }));
    const sut = new GetSentSmsReportHandler(repository);

    const report = await sut.execute(new GetSentSmsReportQuery(senderId));

    expect(report[0]).toMatchObject({ serviceLevel: 'EXPRESS' });
  });

  it("another sender's SMS never appears in the report", async () => {
    const senderId = Identity.new();
    const someoneElse = Identity.new();
    const repository = new FakeSentSmsReportRepository();
    repository.store(senderId, aSentSms({ message: 'Mine.' }));
    repository.store(someoneElse, aSentSms({ message: 'Not mine.' }));
    const sut = new GetSentSmsReportHandler(repository);

    const report = await sut.execute(new GetSentSmsReportQuery(senderId));

    expect(report.map((entry) => entry.message)).toEqual(['Mine.']);
  });

  // 1000 is hardcoded from the tariff's specification rather than read back
  // from `SmsTariff.flat()`: a test that recomputes the value it is checking
  // agrees with the implementation even when both are wrong.
  it('each entry costs the flat tariff', async () => {
    const senderId = Identity.new();
    const repository = new FakeSentSmsReportRepository();
    repository.store(senderId, aSentSms());
    repository.store(senderId, aSentSms());
    const sut = new GetSentSmsReportHandler(repository);

    const report = await sut.execute(new GetSentSmsReportQuery(senderId));

    expect(report.map((entry) => entry.cost)).toEqual([1000, 1000]);
  });
});
