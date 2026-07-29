import { SmsControllerPricing200 } from '../../api/model';

/** What one message costs, as the app talks about it. Always a number and a currency. */
export interface SmsPricing {
  readonly costPerSms: number;
  readonly currency: string;
}

/**
 * Normalises the wire shape into the domain one.
 *
 * Neither member is marked `required` in the OpenAPI contract, so the generated model types both as
 * possibly `undefined`. Rather than push a `?? 0` into the template that renders the price — and
 * risk it printing the literal text "undefined" beside a currency — the app has a single
 * wire-to-domain boundary and this is it, exactly as `core/identity/user-profile.ts` does for the
 * profile. Downstream code decides for itself what a zero cost means.
 */
export function toSmsPricing(dto: SmsControllerPricing200): SmsPricing {
  return {
    costPerSms: dto.costPerSms ?? 0,
    currency: dto.currency ?? '',
  };
}
