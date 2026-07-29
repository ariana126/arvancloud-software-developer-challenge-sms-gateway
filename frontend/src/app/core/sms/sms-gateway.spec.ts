import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SKIP_AUTH } from '../http/auth-context';
import { PROBLEM } from '../http/problem-details';
import { SmsGateway } from './sms-gateway';

const MESSAGE = { recipient: '09121234567', message: 'Your order has shipped.' };

describe('SmsGateway', () => {
  let gateway: SmsGateway;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    gateway = TestBed.inject(SmsGateway);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('sendSms', () => {
    it('posts exactly the two fields the API accepts, and nothing else', async () => {
      // The backend's ValidationPipe runs `forbidNonWhitelisted`, so a third property is a 400.
      const sending = gateway.sendSms(MESSAGE);

      const request = httpMock.expectOne('/api/sms');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual(MESSAGE);

      request.flush(
        { id: '550e8400-e29b-41d4-a716-446655440000', cost: 1000 },
        { status: 201, statusText: 'Created' },
      );
      await expect(sending).resolves.toBeUndefined();
    });

    it('sends the message authenticated, unlike registering or logging in', async () => {
      const sending = gateway.sendSms(MESSAGE);
      const request = httpMock.expectOne('/api/sms');

      // Not opting out is what leaves accessTokenInterceptor free to attach the bearer token.
      expect(request.request.context.get(SKIP_AUTH)).toBe(false);

      request.flush(null, { status: 201, statusText: 'Created' });
      await sending;
    });

    it('resolves on a 201 the contract permits to be empty', async () => {
      const sending = gateway.sendSms(MESSAGE);

      httpMock.expectOne('/api/sms').flush(null, { status: 201, statusText: 'Created' });

      await expect(sending).resolves.toBeUndefined();
    });

    it('rejects when the credit is short, leaving the caller to say so on its form', async () => {
      const sending = gateway.sendSms(MESSAGE);

      httpMock
        .expectOne('/api/sms')
        .flush(
          { type: PROBLEM.insufficientCredit, required: 1000, available: 400 },
          { status: 402, statusText: 'Payment Required' },
        );

      await expect(sending).rejects.toBeDefined();
    });
  });

  describe('pricing', () => {
    it('asks the API what one message costs', async () => {
      const price = firstEmission(gateway.pricing());

      const request = httpMock.expectOne('/api/sms/pricing');
      expect(request.request.method).toBe('GET');

      request.flush({ costPerSms: 1000, currency: 'RIALS' });

      await expect(price).resolves.toEqual({ costPerSms: 1000, currency: 'RIALS' });
    });

    it('turns the empty response the contract permits into a number and a string', async () => {
      const price = firstEmission(gateway.pricing());

      httpMock.expectOne('/api/sms/pricing').flush({});

      await expect(price).resolves.toEqual({ costPerSms: 0, currency: '' });
    });
  });
});

/** Promise for the first value of an Observable, without pulling `firstValueFrom` into the test. */
function firstEmission<T>(source: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    source.subscribe({ next: resolve, error: reject });
  });
}
