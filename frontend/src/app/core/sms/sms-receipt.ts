import { SmsControllerSend201 } from '../../api/model';

/** What the API said about a message it accepted, as the app talks about it. */
export interface SmsReceipt {
  /**
   * The ISO-8601 instant the message is guaranteed to reach the operator by, or `''` when the send
   * promised no time at all. Kept as the API's own string rather than parsed into a `Date`: it is
   * published verbatim as a `<time datetime>`, and re-serialising an instant is how an offset gets
   * lost.
   */
  readonly guaranteedDeliveryAt: string;
}

/**
 * Normalises the wire shape into the domain one, the third of these boundaries in `core/` after
 * `toSmsPricing` and `toUserProfile` and for the same reason.
 *
 * Three shapes arrive here and only one of them is the interesting case. An express send carries
 * `guaranteedDeliveryAt`; a standard send **omits the key entirely** rather than sending null, which
 * is the contract's own wording; and the 201 is permitted to have no body at all, which is why the
 * parameter accepts `null` and `undefined`. All three collapse to a string, so no page ever branches
 * on a missing property and no template can print "undefined" beside a promise.
 *
 * An unparseable instant collapses the same way. That is not defensive padding: the value is handed
 * to `Date` to be turned into something human, and a string `Date` cannot read renders as the words
 * "Invalid Date" — a broken promise shown to the user in place of a missing one shown to nobody.
 */
export function toSmsReceipt(dto: SmsControllerSend201 | null | undefined): SmsReceipt {
  const guaranteedDeliveryAt = dto?.guaranteedDeliveryAt ?? '';
  const isReadableInstant =
    guaranteedDeliveryAt !== '' && !Number.isNaN(Date.parse(guaranteedDeliveryAt));

  return { guaranteedDeliveryAt: isReadableInstant ? guaranteedDeliveryAt : '' };
}
