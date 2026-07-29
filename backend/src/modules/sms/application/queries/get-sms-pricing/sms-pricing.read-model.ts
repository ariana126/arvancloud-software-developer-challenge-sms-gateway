export class SmsPricingReadModel {
  constructor(
    public readonly costPerSms: number,
    public readonly currency: string,
  ) {}
}
