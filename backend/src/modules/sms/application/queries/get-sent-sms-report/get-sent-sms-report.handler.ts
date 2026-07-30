import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetSentSmsReportQuery } from '@sms/application/queries/get-sent-sms-report/get-sent-sms-report.query';
import { SentSmsReadModel } from '@sms/application/queries/get-sent-sms-report/sent-sms.read-model';
import { SentSmsReportRepository } from '@sms/application/queries/get-sent-sms-report/sent-sms-report.repository';
import { SmsTariff } from '@sms/domain/sms-tariff';

@QueryHandler(GetSentSmsReportQuery)
export class GetSentSmsReportHandler implements IQueryHandler<
  GetSentSmsReportQuery,
  SentSmsReadModel[]
> {
  constructor(private readonly repository: SentSmsReportRepository) {}

  /**
   * Reads the sender's rows through a dedicated read port — one query, straight
   * from the data source — and pays for the one thing the rows do not carry.
   *
   * `cost` is composed **here** rather than filled in by the persistence
   * adapter. Pricing is domain knowledge and an adapter's job is to fetch rows;
   * keeping the tariff in this layer is also what leaves this handler with
   * something a unit test can reach without infrastructure. It is the third
   * caller of `SmsTariff.flat()`, alongside `SendSmsHandler` and
   * `GetSmsPricingHandler`, and that stays safe for the reason those two
   * already document: one constant in one class, so no two callers can
   * disagree.
   *
   * The trade that accepts: the report shows the **current** tariff, not what
   * the send was historically charged. That is the same trade
   * `guaranteedDeliveryAt` makes by being derived rather than stored, and it
   * holds exactly as long as the price is flat. The day prices vary over time
   * is the day `cost` earns a column on `sms_message`.
   *
   * The order and the scoping are the port's contract, not this handler's work:
   * nothing here sorts, and nothing here filters.
   */
  async execute(query: GetSentSmsReportQuery): Promise<SentSmsReadModel[]> {
    const tariff = SmsTariff.flat();
    const records = await this.repository.findBySender(query.senderId);

    return records.map(
      (record) =>
        new SentSmsReadModel(
          record.id,
          record.recipient,
          record.message,
          record.status,
          record.serviceLevel,
          tariff.costPerSms(),
          record.sentAt.toISOString(),
        ),
    );
  }
}
