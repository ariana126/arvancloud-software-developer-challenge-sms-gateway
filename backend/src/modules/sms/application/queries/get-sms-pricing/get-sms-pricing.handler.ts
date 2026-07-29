import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetSmsPricingQuery } from '@sms/application/queries/get-sms-pricing/get-sms-pricing.query';
import { SmsPricingReadModel } from '@sms/application/queries/get-sms-pricing/sms-pricing.read-model';
import { SmsTariff } from '@sms/domain/sms-tariff';

@QueryHandler(GetSmsPricingQuery)
export class GetSmsPricingHandler implements IQueryHandler<
  GetSmsPricingQuery,
  SmsPricingReadModel
> {
  /**
   * The only query handler here with no repository behind it: a tariff is
   * domain data, not persisted state. It reads the very same `SmsTariff.flat()`
   * that `SendSmsHandler` charges, which is what makes the published price and
   * the charged price provably one number.
   *
   * Deliberately not `async`: there is nothing to await, and an `async` method
   * without an `await` trips `@typescript-eslint/require-await`.
   */
  execute(): Promise<SmsPricingReadModel> {
    const tariff = SmsTariff.flat();
    return Promise.resolve(
      new SmsPricingReadModel(tariff.costPerSms(), tariff.currency()),
    );
  }
}
