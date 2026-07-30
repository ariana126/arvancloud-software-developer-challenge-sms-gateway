/**
 * One entry in a sender's report. The report itself is a list of these — the
 * handler returns the array directly, with no `{ entries: [...] }` wrapper a
 * client would only have to unwrap.
 *
 * Two shapes worth noting, both following what the send path already publishes:
 *
 * - `message` is the wire spelling of the domain's `body`, matching the
 *   `message` field `SendSmsDto` accepts. What you send under a name is what
 *   you read back under it.
 * - `sentAt` is ISO-8601 rather than a `Date`, for the reason `SendSmsHandler`
 *   writes down for `guaranteedDeliveryAt`: this shape leaves the application
 *   layer, so it carries wire types rather than domain ones.
 * - `cost` carries no currency. The send response returns a bare `cost` too,
 *   and `GET /api/sms/pricing` is where the currency is published — a second
 *   channel for it here would be a second thing to keep in step.
 */
export class SentSmsReadModel {
  constructor(
    public readonly id: string,
    public readonly recipient: string,
    public readonly message: string,
    public readonly status: string,
    public readonly serviceLevel: string,
    public readonly cost: number,
    public readonly sentAt: string,
  ) {}
}
