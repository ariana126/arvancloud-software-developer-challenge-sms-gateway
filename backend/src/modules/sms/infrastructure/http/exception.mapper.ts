import { ExceptionMapper, ProblemDetail } from '@framework/infrastructure';
import { HttpStatus } from '@nestjs/common';
import { RuntimeException } from '@nestjs/core/errors/exceptions';
import { InsufficientCreditException } from '@sms/application/exceptions';

export class SmsExceptionMapper implements ExceptionMapper {
  canMap(exception: unknown): boolean {
    return exception instanceof InsufficientCreditException;
  }

  toProblemDetail(exception: unknown): ProblemDetail {
    if (exception instanceof InsufficientCreditException) {
      return new ProblemDetail(
        'insufficient-credit',
        'Insufficient Credit',
        HttpStatus.PAYMENT_REQUIRED,
        exception.message,
        undefined,
        {
          required: exception.required,
          available: exception.available,
        },
      );
    }

    throw new RuntimeException(
      `Unexpected exception type: ${String(exception)}`,
    );
  }
}
