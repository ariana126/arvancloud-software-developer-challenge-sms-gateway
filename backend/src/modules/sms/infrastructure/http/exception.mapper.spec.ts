import { Identity } from '@framework/domain';
import { HttpExceptionFilter } from '@framework/infrastructure';
import { ArgumentsHost } from '@nestjs/common';
import { InsufficientCreditException } from '@sms/application/exceptions';

import { SmsExceptionMapper } from './exception.mapper';

function rejectionFor(available: number): InsufficientCreditException {
  return InsufficientCreditException.forSms(Identity.new(), 1000, available);
}

/**
 * Captures what the filter actually writes to the response, so the assertions
 * below are about the wire and not about the filter's internals.
 */
function fakeHost(): {
  host: ArgumentsHost;
  status: jest.Mock;
  body: () => Record<string, unknown>;
} {
  const written: Array<Record<string, unknown>> = [];
  const json = jest.fn((payload: Record<string, unknown>) => {
    written.push(payload);
  });
  const header = jest.fn().mockReturnValue({ json });
  const status = jest.fn().mockReturnValue({ header });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, body: () => written[0] };
}

describe('SmsExceptionMapper', () => {
  it('claims an insufficient-credit rejection', () => {
    const sut = new SmsExceptionMapper();
    expect(sut.canMap(rejectionFor(400))).toBe(true);
  });

  it('leaves an unrelated error to another mapper', () => {
    const sut = new SmsExceptionMapper();
    expect(sut.canMap(new Error('something else'))).toBe(false);
  });

  it('reports an insufficient balance as 402 Payment Required', () => {
    const sut = new SmsExceptionMapper();
    expect(sut.toProblemDetail(rejectionFor(400)).status).toBe(402);
  });

  it('carries what was required and what was available to the client', () => {
    const sut = new SmsExceptionMapper();

    const body = sut.toProblemDetail(rejectionFor(400)).asResponseBody();

    expect(body).toMatchObject({
      type: 'https://my-api-doc.dev/problems/insufficient-credit',
      title: 'Insufficient Credit',
      status: 402,
      required: 1000,
      available: 400,
    });
  });
});

/**
 * The registration check. `HttpExceptionFilter` composes a hardcoded
 * `ExceptionMappers` array — not DI — so a mapper that exists but was never
 * added to it fails silently as a 500 rather than throwing. These drive the
 * real filter, with its real chain, so they fail if that line is ever dropped.
 */
describe('the exception filter chain', () => {
  it('answers an insufficient-credit rejection with 402, not a generic 500', () => {
    const sut = new HttpExceptionFilter();
    const { host, status } = fakeHost();

    sut.catch(rejectionFor(400), host);

    expect(status).toHaveBeenCalledWith(402);
  });

  it('passes 402 through to the body unaltered, rather than normalising it', () => {
    const sut = new HttpExceptionFilter();
    const { host, body } = fakeHost();

    sut.catch(rejectionFor(400), host);

    expect(body()).toMatchObject({
      type: 'https://my-api-doc.dev/problems/insufficient-credit',
      status: 402,
      required: 1000,
      available: 400,
    });
  });
});
