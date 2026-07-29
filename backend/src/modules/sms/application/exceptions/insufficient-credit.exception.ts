import { ApplicationException } from '@framework/application';
import { Identity } from '@framework/domain';

/**
 * The sms module's own account of a rejected charge. `SendSmsHandler`
 * translates credit's domain `InsufficientCredit` into this at the seam, so the
 * other module's exception type never travels further than the handler that
 * called the port — the HTTP layer only ever maps this one.
 */
export class InsufficientCreditException extends ApplicationException {
  private constructor(
    message: string,
    public readonly userId: Identity,
    public readonly required: number,
    public readonly available: number,
  ) {
    super(message);
  }

  public static forSms(
    userId: Identity,
    required: number,
    available: number,
  ): InsufficientCreditException {
    return new InsufficientCreditException(
      `Sending an SMS costs ${required}, but user ${userId.asString()} has only ${available}.`,
      userId,
      required,
      available,
    );
  }
}
