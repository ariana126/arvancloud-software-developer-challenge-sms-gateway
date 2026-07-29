import { Injectable, inject } from '@angular/core';
import { firstValueFrom, map, Observable } from 'rxjs';

import { SendSmsDto, SendSmsDtoServiceLevel } from '../../api/model';
import { SmsService } from '../../api/sms/sms.service';
import { SmsPricing, toSmsPricing } from './sms-pricing';
import { SmsReceipt, toSmsReceipt } from './sms-receipt';

/**
 * A message the app has been asked to send.
 *
 * `express` is a boolean because that is what the choice is — a ticked box — and because the wire's
 * vocabulary for it (`'STANDARD' | 'EXPRESS'`) is a detail of the contract. Translating the one into
 * the other is this gateway's job, so no page ever holds a wire literal and none of them imports
 * from `api/`: every such import in this app is in `core/`, and keeping it that way is what lets the
 * contract's naming change without a page noticing.
 */
export interface SmsToSend {
  readonly recipient: string;
  readonly message: string;
  /** Express delivery is opt-in. `false` is an ordinary send, and the default everywhere. */
  readonly express: boolean;
}

/**
 * The app's one way in and out of the SMS API.
 *
 * It wraps the generated service rather than replacing it: the generated code owns the routes and
 * the payload shapes, and this owns what it cannot know — that a price is two guaranteed values
 * rather than two optional ones, and that neither call is anonymous.
 *
 * Note the absence of `{ context: anonymous() }`. Both operations are `bearer`-secured in the
 * contract, so `accessTokenInterceptor` attaches the token and the two opt-out call sites in
 * `IdentityGateway` remain the only ones in the app.
 *
 * `sendSms` takes `SmsToSend` rather than the generated `SendSmsDto`, which is a deliberate departure
 * from how `IdentityGateway` takes its DTOs straight through. The reason that pattern exists —
 * `forbidNonWhitelisted` makes one stray property a 400, so let the compiler prevent it — is
 * unchanged and still holds here: the DTO is built as a `SendSmsDto` literal inside `sendSms`, so the
 * compiler still checks every property against the contract, one layer in. What the extra layer buys
 * is that the boolean-to-level translation happens once, in the place that already knows the wire.
 */
@Injectable({ providedIn: 'root' })
export class SmsGateway {
  private readonly sms = inject(SmsService);

  /**
   * Resolves with what the API promised about the message, and rejects otherwise — the caller maps
   * the rejection onto its form.
   *
   * `serviceLevel` is always named, never omitted. The contract makes it optional and applies
   * `STANDARD` server-side when a request says nothing, so sending it is not required — but a request
   * that states its own intent cannot have its meaning changed by a change of server default, and
   * `'STANDARD'` is a value the contract's enum already lists, so it costs nothing to say.
   *
   * The 201's `id` and `cost` are still discarded: the page's confirmation names the recipient the
   * user typed and quotes no amount, so returning them would be an unread value. `guaranteedDeliveryAt`
   * is not, because the confirmation now says when the message will arrive.
   */
  async sendSms(details: SmsToSend): Promise<SmsReceipt> {
    const dto: SendSmsDto = {
      recipient: details.recipient,
      message: details.message,
      serviceLevel: details.express
        ? SendSmsDtoServiceLevel.EXPRESS
        : SendSmsDtoServiceLevel.STANDARD,
    };

    const created = await firstValueFrom(this.sms.smsControllerSend(dto), {
      // A response that completes without emitting would otherwise reject with `EmptyError`, turning
      // a success into a thrown error. `toSmsReceipt` takes that `undefined` as "promised nothing".
      defaultValue: undefined,
    });

    return toSmsReceipt(created);
  }

  pricing(): Observable<SmsPricing> {
    return this.sms.smsControllerPricing().pipe(map(toSmsPricing));
  }
}
