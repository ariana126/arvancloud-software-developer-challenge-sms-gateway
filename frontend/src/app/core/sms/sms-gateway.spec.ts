import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SKIP_AUTH } from '../http/auth-context';
import { PROBLEM } from '../http/problem-details';
import { SmsGateway } from './sms-gateway';

const MESSAGE = { recipient: '09121234567', message: 'Your order has shipped.', express: false };

/** What the wire carries for the same message. The boolean becomes a level here and nowhere else. */
const STANDARD_BODY = {
  recipient: MESSAGE.recipient,
  message: MESSAGE.message,
  serviceLevel: 'STANDARD',
};

const CREATED = { status: 201, statusText: 'Created' };

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
    it('posts exactly the three fields the API accepts, and nothing else', async () => {
      // The backend's ValidationPipe runs `forbidNonWhitelisted`, so a fourth property is a 400.
      const sending = gateway.sendSms(MESSAGE);

      const request = httpMock.expectOne('/api/sms');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual(STANDARD_BODY);

      request.flush({ id: '550e8400-e29b-41d4-a716-446655440000', cost: 1000 }, CREATED);
      await expect(sending).resolves.toEqual({ guaranteedDeliveryAt: '' });
    });

    it('names the express level when the caller asked for express delivery', async () => {
      const sending = gateway.sendSms({ ...MESSAGE, express: true });

      const request = httpMock.expectOne('/api/sms');
      expect(request.request.body.serviceLevel).toBe('EXPRESS');

      request.flush({ id: 'an-id', cost: 1000 }, CREATED);
      await sending;
    });

    it('names the standard level rather than leaving the API to assume it', async () => {
      // The contract makes `serviceLevel` optional and defaults it server-side. Saying STANDARD out
      // loud costs nothing and means the request states its own intent, so a change of server
      // default cannot silently change what an unticked box means.
      const sending = gateway.sendSms({ ...MESSAGE, express: false });

      const request = httpMock.expectOne('/api/sms');
      expect(request.request.body.serviceLevel).toBe('STANDARD');

      request.flush({ id: 'an-id', cost: 1000 }, CREATED);
      await sending;
    });

    it('hands back the instant an express message is guaranteed by', async () => {
      const sending = gateway.sendSms({ ...MESSAGE, express: true });

      httpMock
        .expectOne('/api/sms')
        .flush(
          { id: 'an-id', cost: 1000, guaranteedDeliveryAt: '2026-01-01T00:05:00.000Z' },
          CREATED,
        );

      await expect(sending).resolves.toEqual({
        guaranteedDeliveryAt: '2026-01-01T00:05:00.000Z',
      });
    });

    it('promises no time when the API named none, rather than passing undefined on', async () => {
      // A standard send omits the key entirely — it is absent, not null.
      const sending = gateway.sendSms(MESSAGE);

      httpMock.expectOne('/api/sms').flush({ id: 'an-id', cost: 1000 }, CREATED);

      await expect(sending).resolves.toEqual({ guaranteedDeliveryAt: '' });
    });

    it('promises no time when the instant is not one it can read', async () => {
      // Nothing downstream should have to defend against rendering "Invalid Date".
      const sending = gateway.sendSms({ ...MESSAGE, express: true });

      httpMock
        .expectOne('/api/sms')
        .flush({ id: 'an-id', cost: 1000, guaranteedDeliveryAt: 'soon' }, CREATED);

      await expect(sending).resolves.toEqual({ guaranteedDeliveryAt: '' });
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

      httpMock.expectOne('/api/sms').flush(null, CREATED);

      // No body at all is still a send that promised no time — never a rejected promise.
      await expect(sending).resolves.toEqual({ guaranteedDeliveryAt: '' });
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
