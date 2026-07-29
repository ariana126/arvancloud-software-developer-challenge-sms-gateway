import { Injectable, inject } from '@angular/core';
import { firstValueFrom, map, Observable } from 'rxjs';

import { SendSmsDto } from '../../api/model';
import { SmsService } from '../../api/sms/sms.service';
import { SmsPricing, toSmsPricing } from './sms-pricing';

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
 * Taking `SendSmsDto` (the generated type) is deliberate, for the same reason `IdentityGateway`
 * takes its DTOs: the backend's validation pipe runs `forbidNonWhitelisted`, so a single stray
 * property is a 400, and typing the parameter as the DTO makes the compiler the thing that prevents
 * it rather than a stripping step someone has to remember.
 */
@Injectable({ providedIn: 'root' })
export class SmsGateway {
  private readonly sms = inject(SmsService);

  /**
   * Resolves when the message has been accepted and charged, and rejects otherwise — the caller maps
   * the rejection onto its form.
   *
   * The 201 carries an `id` and a `cost`, and both are discarded: the page's confirmation names the
   * recipient the user typed and quotes no amount, so returning them would be an unread value. If a
   * "1,000 RIALS charged" line is ever wanted, this returns the pair normalised the way
   * `toSmsPricing` normalises the price, and nothing else about the slice changes.
   */
  async sendSms(details: SendSmsDto): Promise<void> {
    await firstValueFrom(this.sms.smsControllerSend(details), {
      // A response that completes without emitting would otherwise reject with `EmptyError`, turning
      // a success into a thrown error. Nothing here reads the value, so there is nothing to lose.
      defaultValue: undefined,
    });
  }

  pricing(): Observable<SmsPricing> {
    return this.sms.smsControllerPricing().pipe(map(toSmsPricing));
  }
}
