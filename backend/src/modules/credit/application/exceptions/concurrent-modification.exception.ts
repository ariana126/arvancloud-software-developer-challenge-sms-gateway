import { ApplicationException } from '@framework/application';
import { Identity } from '@framework/domain';

export class ConcurrentModificationException extends ApplicationException {
  private constructor(
    message: string,
    public readonly userId: Identity,
  ) {
    super(message);
  }

  public static forWallet(userId: Identity): ConcurrentModificationException {
    return new ConcurrentModificationException(
      `Could not update the wallet for user ${userId.asString()}: too many concurrent modifications.`,
      userId,
    );
  }
}
