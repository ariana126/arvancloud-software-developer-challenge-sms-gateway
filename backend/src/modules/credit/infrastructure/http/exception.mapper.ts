import { ConcurrentModificationException } from '@credit/application/exceptions';
import { ExceptionMapper, ProblemDetail } from '@framework/infrastructure';
import { HttpStatus } from '@nestjs/common';
import { RuntimeException } from '@nestjs/core/errors/exceptions';

export class CreditExceptionMapper implements ExceptionMapper {
  canMap(exception: unknown): boolean {
    return exception instanceof ConcurrentModificationException;
  }

  toProblemDetail(exception: unknown): ProblemDetail {
    if (exception instanceof ConcurrentModificationException) {
      return new ProblemDetail(
        'concurrent-modification',
        'Concurrent Modification',
        HttpStatus.CONFLICT,
        exception.message,
        undefined,
        {
          userId: exception.userId.asString(),
        },
      );
    }

    throw new RuntimeException(
      `Unexpected exception type: ${String(exception)}`,
    );
  }
}
