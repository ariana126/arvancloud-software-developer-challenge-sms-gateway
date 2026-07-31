import { Identity } from '@framework/domain';
import { PrismaService } from '@framework/infrastructure';
import { SmsMessage as PrismaSmsMessage } from '@prisma/client';

import { PrismaSentSmsReportRepository } from './sent-sms-report.repository';

function fakePrisma(): {
  prisma: PrismaService;
  smsMessage: { findMany: jest.Mock };
} {
  const smsMessage = { findMany: jest.fn().mockResolvedValue([]) };
  return { prisma: { smsMessage } as unknown as PrismaService, smsMessage };
}

function aRow(overrides: Partial<PrismaSmsMessage> = {}): PrismaSmsMessage {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    senderId: 'sender-1',
    recipient: '09121234567',
    body: 'Your order has shipped.',
    status: 'SENT',
    serviceLevel: 'STANDARD',
    sentAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaSentSmsReportRepository', () => {
  // Scoping and ordering are asserted on the query itself rather than on the
  // returned rows, because the database is what performs them: a fake that
  // sorted or filtered on their behalf would only be testing the fake. This is
  // the same trade PrismaWalletRepository's spec makes for its conditional write.
  /**
   * The `status` half matters as much as the `senderId` half: a message is
   * written `PENDING` alongside the charge and only becomes `SENT` once the
   * carrier has taken it, so without that predicate this report would announce
   * messages still sitting in the outbox, and ones dead-lettered after the
   * carrier refused them for good.
   */
  it('asks the database for one sender, sent messages only, newest first', async () => {
    const { prisma, smsMessage } = fakePrisma();
    const sut = new PrismaSentSmsReportRepository(prisma);

    await sut.findBySender(Identity.fromString('sender-1'));

    expect(smsMessage.findMany).toHaveBeenCalledWith({
      where: { senderId: 'sender-1', status: 'SENT' },
      orderBy: { sentAt: 'desc' },
    });
  });

  it('reads a row back as a record, publishing the body as the message', async () => {
    const { prisma, smsMessage } = fakePrisma();
    smsMessage.findMany.mockResolvedValue([
      aRow({ body: 'Your parcel is here.', serviceLevel: 'EXPRESS' }),
    ]);
    const sut = new PrismaSentSmsReportRepository(prisma);

    const records = await sut.findBySender(Identity.fromString('sender-1'));

    expect(records).toEqual([
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        recipient: '09121234567',
        message: 'Your parcel is here.',
        status: 'SENT',
        serviceLevel: 'EXPRESS',
        sentAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
  });

  it('answers a sender with no rows with an empty report, not a failure', async () => {
    const { prisma } = fakePrisma();
    const sut = new PrismaSentSmsReportRepository(prisma);

    await expect(
      sut.findBySender(Identity.fromString('sender-1')),
    ).resolves.toEqual([]);
  });
});
