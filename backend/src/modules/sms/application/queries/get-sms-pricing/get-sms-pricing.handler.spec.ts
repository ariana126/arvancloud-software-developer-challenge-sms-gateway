import { GetSmsPricingHandler } from './get-sms-pricing.handler';

describe('GetSmsPricingHandler', () => {
  it('publishes the flat price of one SMS', async () => {
    const sut = new GetSmsPricingHandler();

    const result = await sut.execute();

    expect(result.costPerSms).toBe(1000);
  });

  it('publishes the currency the price is quoted in', async () => {
    const sut = new GetSmsPricingHandler();

    const result = await sut.execute();

    expect(result.currency).toBe('RIALS');
  });
});
