import { Identity } from '@framework/domain';
import { PrismaService } from '@framework/infrastructure';
import { Injectable } from '@nestjs/common';
import { SmsMessage as PrismaSmsMessage } from '@prisma/client';
import {
  SentSmsRecord,
  SentSmsReportRepository,
} from '@sms/application/queries/get-sent-sms-report/sent-sms-report.repository';

/**
 * The read side's adapter: one `findMany`, straight at the table, with no
 * aggregate rehydrated on the way. `PrismaEntityRepository` is deliberately not
 * the base class here — that base exists to load, save and publish events for a
 * write model, and none of those three are what a report needs. Reconstituting
 * every row into an `SmsMessage` only to read six fields back off it would cost
 * a crop of getters for no reader's benefit.
 *
 * Both halves of the port's contract are pushed into the query rather than
 * applied after it:
 *
 * - **`where: { senderId }`** — the database returns one sender's rows and
 *   nothing else. Fetching more and filtering in JS would make a leak a matter
 *   of a later `map` staying correct, and would read rows this caller is not
 *   entitled to. `@@index([senderId])` on `SmsMessage` is what keeps that
 *   predicate off a sequential scan as the table grows.
 * - **`orderBy: { sentAt: 'desc' }`** — newest first, sorted by the database.
 *   Row order out of an unordered `findMany` is not a promise Postgres makes.
 *
 * An empty result is a result: a sender who has sent nothing yields `[]`, and
 * this method has no branch that could turn that into a throw.
 */
@Injectable()
export class PrismaSentSmsReportRepository extends SentSmsReportRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  public async findBySender(senderId: Identity): Promise<SentSmsRecord[]> {
    const records = await this.prisma.smsMessage.findMany({
      where: { senderId: senderId.asString() },
      orderBy: { sentAt: 'desc' },
    });

    return records.map((record) => this.toRecord(record));
  }

  /**
   * Projects a row onto the port's record. The one rename is `body` → `message`:
   * the column keeps the domain's word and the read model publishes the wire's,
   * so this is the seam where the two meet. `cost` is absent because it is not a
   * column — the handler composes it from `SmsTariff`.
   */
  private toRecord(record: PrismaSmsMessage): SentSmsRecord {
    return {
      id: record.id,
      recipient: record.recipient,
      message: record.body,
      status: record.status,
      serviceLevel: record.serviceLevel,
      sentAt: record.sentAt,
    };
  }
}
