import { SmsDispatch } from '@sms/domain/service/sms-outbox.repository';

/**
 * Where a claimed outbox row goes.
 *
 * **This is the seam a broker plugs into.** Today `ProviderSmsDispatchPublisher`
 * hands the message straight to `SmsProvider`, so a send is dispatched in the
 * request that made it. When Kafka arrives, a producer implements this instead
 * and a consumer calls `SmsProvider` on the far side — the outbox table, the
 * claim query, the retry policy, the transaction and the whole domain stay
 * exactly as they are, and `SmsModule` changes by one line.
 *
 * That is the reason the outbox exists now rather than later: producing to a
 * broker from the command handler would be a dual write across Postgres and the
 * broker with no transaction spanning them, and no amount of broker
 * configuration fixes that. Writing the row in the same transaction as the
 * charge, and relaying it afterwards, does.
 */
export abstract class SmsDispatchPublisher {
  public abstract publish(dispatch: SmsDispatch): Promise<void>;
}
