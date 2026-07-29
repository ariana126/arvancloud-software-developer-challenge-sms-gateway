import { CreditExceptionMapper } from '@credit/infrastructure/http/exception.mapper';
import { IdentityExceptionMapper } from '@identity/infrastructure/http/exception.mapper';
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { SmsExceptionMapper } from '@sms/infrastructure/http/exception.mapper';
import { Response } from 'express';

import { FrameworkExceptionMapper } from './exception.mapper';
import { ExceptionMapper } from './exception-mapper.interface';
import { ProblemDetail } from './problem-detail';

const ExceptionMappers: ExceptionMapper[] = [
  new FrameworkExceptionMapper(),
  new IdentityExceptionMapper(),
  new CreditExceptionMapper(),
  new SmsExceptionMapper(),
];

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const problemDetail: ProblemDetail = this.getProblemDetail(exception);
    return response
      .status(problemDetail.status)
      .header('Content-Type', 'application/problem+json')
      .json(problemDetail.asResponseBody());
  }

  private getProblemDetail(exception: unknown): ProblemDetail {
    for (const mapper of ExceptionMappers) {
      if (!mapper.canMap(exception)) {
        continue;
      }
      return mapper.toProblemDetail(exception);
    }
    return ProblemDetail.forUnknownError();
  }
}
