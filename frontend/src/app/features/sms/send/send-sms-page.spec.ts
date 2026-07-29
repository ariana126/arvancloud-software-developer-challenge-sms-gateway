import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PROBLEM } from '../../../core/http/problem-details';
import { SendSmsPage } from './send-sms-page';

const VALID = { recipient: '09121234567', message: 'Your order has shipped.' };

const SENT_CONFIRMATION = 'Your SMS has been sent to 09121234567';
const NOT_ENOUGH_CREDIT = 'You do not have enough credit to send this SMS';

/**
 * The phrase the acceptance suite reads the guarantee by, and the instant the API promises with it.
 * Both are a contract with QA: the sentence above may be appended to but never reworded, and the
 * suite parses the `datetime` attribute rather than the rendered text — which is what leaves the
 * human formatting free to change without breaking anything.
 */
const GUARANTEE_PHRASE = 'reach the operator by';
const GUARANTEED_AT = '2026-01-01T00:05:00.000Z';

const CREATED = { status: 201, statusText: 'Created' };

describe('SendSmsPage', () => {
  let httpMock: HttpTestingController;
  let router: Router;
  let harness: RouterTestingHarness;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'send-sms', component: SendSmsPage }]),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /**
   * The price resource fires as the component is constructed, so every test has that request to
   * answer whether it cares about the price or not — `httpMock.verify()` fails otherwise.
   */
  async function openPage(
    pricing: { costPerSms?: number; currency?: string } | 'unavailable' = {
      costPerSms: 1000,
      currency: 'RIALS',
    },
  ): Promise<HTMLElement> {
    harness = await RouterTestingHarness.create('/send-sms');

    const request = httpMock.expectOne('/api/sms/pricing');
    if (pricing === 'unavailable') {
      request.error(new ProgressEvent('error'));
    } else {
      request.flush(pricing);
    }
    await settle();

    return harness.routeNativeElement as HTMLElement;
  }

  function control(page: HTMLElement, id: string): HTMLInputElement {
    return page.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function alertText(page: HTMLElement): string {
    return page.querySelector('form [role="alert"]')!.textContent!.trim();
  }

  function statusText(page: HTMLElement): string {
    return page.querySelector('form [role="status"]')!.textContent!.trim();
  }

  /** Submitting is a promise chain; one stabilisation only covers its first link. */
  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }

  async function fillIn(page: HTMLElement, values: Partial<typeof VALID>): Promise<void> {
    for (const [id, value] of Object.entries(values)) {
      const input = control(page, id);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
    }
    await harness.fixture.whenStable();
  }

  async function submitForm(page: HTMLElement): Promise<void> {
    page.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  }

  async function sendWith(values = VALID): Promise<HTMLElement> {
    const page = await openPage();
    await fillIn(page, values);
    await submitForm(page);

    return page;
  }

  /** Ticking the box is a click, not a value assignment — the checkbox reads `checked`. */
  async function tickExpress(page: HTMLElement): Promise<void> {
    control(page, 'express').click();
    await harness.fixture.whenStable();
  }

  async function sendExpress(): Promise<HTMLElement> {
    const page = await openPage();
    await fillIn(page, VALID);
    await tickExpress(page);
    await submitForm(page);

    return page;
  }

  function publishedTimes(page: HTMLElement): NodeListOf<HTMLElement> {
    return page.querySelectorAll<HTMLElement>('form [role="status"] time');
  }

  /** The text of the element(s) the control's aria-describedby points at. */
  function describedText(page: HTMLElement, id: string): string {
    const describedBy = control(page, id).getAttribute('aria-describedby');
    if (describedBy === null) {
      return '';
    }

    return describedBy
      .split(' ')
      .map((token) => page.querySelector(`#${token}`)?.textContent ?? '')
      .join(' ');
  }

  describe('the form itself', () => {
    it('carries novalidate, so the browser does not pre-empt the accessible errors', async () => {
      expect((await openPage()).querySelector('form')!.hasAttribute('novalidate')).toBe(true);
    });

    it('labels both controls with the words the product uses for them', async () => {
      const page = await openPage();

      expect(page.querySelector('label[for="recipient"]')!.textContent!.trim()).toBe(
        'Recipient number',
      );
      expect(page.querySelector('label[for="message"]')!.textContent!.trim()).toBe('Message');
    });

    it('offers a real submit button that says what it does', async () => {
      const button = (await openPage()).querySelector('form button[type="submit"]')!;

      expect(button.textContent).toContain('Send SMS');
    });

    it('asks for a phone number as a phone number', async () => {
      const recipient = control(await openPage(), 'recipient');

      expect(recipient.type).toBe('tel');
      expect(recipient.getAttribute('autocomplete')).toBe('tel');
    });

    it('states the length limit before anything is wrong', async () => {
      expect(describedText(await openPage(), 'message')).toContain('160 characters');
    });
  });

  describe('the price', () => {
    it('shows what one message costs, and points the submit button at it', async () => {
      const page = await openPage({ costPerSms: 1000, currency: 'RIALS' });

      const button = page.querySelector('form button[type="submit"]')!;
      const hint = page.querySelector(`#${button.getAttribute('aria-describedby')}`);
      expect(hint!.textContent).toContain('1,000 RIALS');
    });

    it('says nothing at all when the price cannot be fetched', async () => {
      const page = await openPage('unavailable');

      // A price that did not load must not read as a send that failed.
      expect(alertText(page)).toBe('');
      expect(
        page.querySelector('form button[type="submit"]')!.hasAttribute('aria-describedby'),
      ).toBe(false);
    });
  });

  describe('before the API is involved', () => {
    it('refuses to submit an empty form and says why, without spending a request', async () => {
      const page = await openPage();

      await submitForm(page);

      httpMock.expectNone('/api/sms');
      expect(describedText(page, 'recipient')).toContain('Enter the number');
      expect(describedText(page, 'message')).toContain('Write the message');
    });

    it('rejects a number the API would reject, before spending a request', async () => {
      const page = await openPage();

      await fillIn(page, { ...VALID, recipient: '1234' });
      await submitForm(page);

      httpMock.expectNone('/api/sms');
      expect(describedText(page, 'recipient')).toContain('Iranian mobile number');
    });

    it('accepts the international form of the same number', async () => {
      const page = await openPage();

      await fillIn(page, { ...VALID, recipient: '+989121234567' });
      await submitForm(page);

      const request = httpMock.expectOne('/api/sms');
      expect(request.request.body.recipient).toBe('+989121234567');

      request.flush(null, { status: 201, statusText: 'Created' });
      await settle();
    });

    it('reports a message over the limit rather than silently truncating it', async () => {
      const page = await openPage();
      const tooLong = 'x'.repeat(161);

      await fillIn(page, { ...VALID, message: tooLong });
      await submitForm(page);

      httpMock.expectNone('/api/sms');
      // The whole point of validating rather than capping: the text the user pasted is still there.
      expect(control(page, 'message').value).toHaveLength(161);
      expect(control(page, 'message').hasAttribute('maxlength')).toBe(false);
      expect(describedText(page, 'message')).toContain('160 characters');
    });

    it('moves focus to the first invalid control in reading order', async () => {
      const page = await openPage();

      await submitForm(page);

      expect(document.activeElement).toBe(control(page, 'recipient'));
    });
  });

  describe('a message that goes through', () => {
    it('posts what the user typed, at the level the unticked box means', async () => {
      await sendWith();

      const request = httpMock.expectOne('/api/sms');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ ...VALID, serviceLevel: 'STANDARD' });

      request.flush({ id: 'an-id', cost: 1000 }, { status: 201, statusText: 'Created' });
      await settle();
    });

    it('stays on the page and names the recipient it was sent to', async () => {
      const page = await sendWith();

      httpMock
        .expectOne('/api/sms')
        .flush({ id: 'an-id', cost: 1000 }, { status: 201, statusText: 'Created' });
      await settle();

      expect(statusText(page)).toBe(SENT_CONFIRMATION);
      expect(router.url).toBe('/send-sms');
    });

    it('empties the form for the next message, without flashing errors at the fields it cleared', async () => {
      const page = await sendWith();

      httpMock.expectOne('/api/sms').flush(null, { status: 201, statusText: 'Created' });
      await settle();

      expect(control(page, 'recipient').value).toBe('');
      expect(control(page, 'message').value).toBe('');
      expect(page.querySelectorAll('.field__error')).toHaveLength(0);
    });

    it('leaves the confirmation alone until the next attempt begins', async () => {
      const page = await sendWith();

      httpMock.expectOne('/api/sms').flush(null, { status: 201, statusText: 'Created' });
      await settle();
      expect(statusText(page)).toBe(SENT_CONFIRMATION);

      await fillIn(page, VALID);
      await submitForm(page);

      // A stale success beside a failing attempt would be the worst of both.
      expect(statusText(page)).toBe('');
      httpMock.expectOne('/api/sms').flush(null, { status: 201, statusText: 'Created' });
      await settle();
    });
  });

  describe('express delivery', () => {
    it('offers it through the shared checkbox field, unticked', async () => {
      const page = await openPage();

      // Rendered through app-checkbox-field, like every other field on this form is rendered through
      // its wrapper: that is where the label pairing and the error markup are wired.
      expect(page.querySelector('form app-checkbox-field')).not.toBeNull();
      expect(control(page, 'express').type).toBe('checkbox');
      expect(control(page, 'express').checked).toBe(false);
      expect(page.querySelector('label[for="express"]')!.textContent!.trim()).toBe(
        'Express delivery',
      );
    });

    it('leaves the box free of a required attribute, so an unticked one cannot block the submit', async () => {
      // `required()` on this field would make [formField] write a real `required` attribute, and the
      // browser would then refuse to submit until the box was ticked. Express is opt-in. jsdom runs
      // no constraint validation, so only the absent attribute can stand in for that here.
      expect(control(await openPage(), 'express').hasAttribute('required')).toBe(false);
    });

    it('asks for the express level when the box is ticked', async () => {
      await sendExpress();

      const request = httpMock.expectOne('/api/sms');
      expect(request.request.body).toEqual({ ...VALID, serviceLevel: 'EXPRESS' });

      request.flush({ id: 'an-id', cost: 1000, guaranteedDeliveryAt: GUARANTEED_AT }, CREATED);
      await settle();
    });

    it('keeps the sentence QA reads and appends the guarantee to it', async () => {
      const page = await sendExpress();

      httpMock
        .expectOne('/api/sms')
        .flush({ id: 'an-id', cost: 1000, guaranteedDeliveryAt: GUARANTEED_AT }, CREATED);
      await settle();

      expect(statusText(page)).toContain(SENT_CONFIRMATION);
      expect(statusText(page)).toContain(GUARANTEE_PHRASE);
    });

    it('publishes the instant as a single machine-readable time', async () => {
      const page = await sendExpress();

      httpMock
        .expectOne('/api/sms')
        .flush({ id: 'an-id', cost: 1000, guaranteedDeliveryAt: GUARANTEED_AT }, CREATED);
      await settle();

      // One <time>, so "the guarantee" is never ambiguous, and its datetime is the full instant the
      // API returned — offset intact, because it is that string and not a re-serialised copy.
      expect(publishedTimes(page)).toHaveLength(1);
      expect(publishedTimes(page)[0].getAttribute('datetime')).toBe(GUARANTEED_AT);
      expect(publishedTimes(page)[0].textContent!.trim()).not.toBe('');
    });

    it('promises nothing at all when the send was standard', async () => {
      const page = await sendWith();

      httpMock.expectOne('/api/sms').flush({ id: 'an-id', cost: 1000 }, CREATED);
      await settle();

      expect(publishedTimes(page)).toHaveLength(0);
      expect(statusText(page)).not.toContain(GUARANTEE_PHRASE);
      expect(statusText(page)).toBe(SENT_CONFIRMATION);
    });

    it('unticks the box with the rest of the form, so the next message is standard again', async () => {
      const page = await sendExpress();

      httpMock
        .expectOne('/api/sms')
        .flush({ id: 'an-id', cost: 1000, guaranteedDeliveryAt: GUARANTEED_AT }, CREATED);
      await settle();

      // Express is a per-message choice, and a box left ticked spends the next message's premium
      // without being asked.
      expect(control(page, 'express').checked).toBe(false);
    });

    it('leaves the box ticked when the send failed, so a retry is still express', async () => {
      const page = await sendExpress();

      httpMock
        .expectOne('/api/sms')
        .flush(
          { type: PROBLEM.insufficientCredit },
          { status: 402, statusText: 'Payment Required' },
        );
      await settle();

      expect(control(page, 'express').checked).toBe(true);
    });

    it('drops a previous guarantee as soon as the next attempt begins', async () => {
      const page = await sendExpress();

      httpMock
        .expectOne('/api/sms')
        .flush({ id: 'an-id', cost: 1000, guaranteedDeliveryAt: GUARANTEED_AT }, CREATED);
      await settle();
      expect(publishedTimes(page)).toHaveLength(1);

      await fillIn(page, VALID);
      await submitForm(page);

      // A promise from the last message must not hang over this one.
      expect(publishedTimes(page)).toHaveLength(0);
      httpMock.expectOne('/api/sms').flush(null, CREATED);
      await settle();
    });
  });

  describe('when the credit is short', () => {
    it('says so on the form, in the words the product uses', async () => {
      const page = await sendWith();

      httpMock.expectOne('/api/sms').flush(
        {
          type: PROBLEM.insufficientCredit,
          detail: 'Sending an SMS costs 1000, but the sender has only 400.',
          required: 1000,
          available: 400,
        },
        { status: 402, statusText: 'Payment Required' },
      );
      await settle();

      expect(alertText(page)).toBe(NOT_ENOUGH_CREDIT);
      expect(statusText(page)).toBe('');
      expect(router.url).toBe('/send-sms');
    });

    it('does not echo the API wording, which quotes amounts in the server voice', async () => {
      const page = await sendWith();

      httpMock.expectOne('/api/sms').flush(
        {
          type: PROBLEM.insufficientCredit,
          detail: 'Sending an SMS costs 1000, but the sender has only 400.',
        },
        { status: 402, statusText: 'Payment Required' },
      );
      await settle();

      expect(page.textContent).not.toContain('Sending an SMS costs');
    });

    it('moves focus to the banner, since no single field is at fault', async () => {
      const page = await sendWith();

      httpMock
        .expectOne('/api/sms')
        .flush(
          { type: PROBLEM.insufficientCredit },
          { status: 402, statusText: 'Payment Required' },
        );
      await settle();

      expect(document.activeElement).toBe(page.querySelector('#send-sms-alert'));
    });

    it('keeps the message, so nothing has to be retyped after topping up', async () => {
      const page = await sendWith();

      httpMock
        .expectOne('/api/sms')
        .flush(
          { type: PROBLEM.insufficientCredit },
          { status: 402, statusText: 'Payment Required' },
        );
      await settle();

      expect(control(page, 'message').value).toBe(VALID.message);
    });
  });

  describe('when the API refuses for another reason', () => {
    it('puts a server-side field error under the field the API named', async () => {
      const page = await sendWith();

      httpMock.expectOne('/api/sms').flush(
        {
          type: PROBLEM.validationError,
          errors: [
            { field: 'recipient', message: 'recipient must match /^09\\d{9}$/ regular expression' },
          ],
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle();

      expect(describedText(page, 'recipient')).toContain('Iranian mobile number');
      expect(control(page, 'recipient').getAttribute('aria-invalid')).toBe('true');
    });

    it('names the real cause when the credit was being changed at the same time', async () => {
      const page = await sendWith();

      httpMock
        .expectOne('/api/sms')
        .flush({ type: PROBLEM.concurrentModification }, { status: 409, statusText: 'Conflict' });
      await settle();

      expect(alertText(page)).toContain('Try sending again');
    });

    it('shows the fallback in the alert when the connection drops, and stays put', async () => {
      const page = await sendWith();

      httpMock.expectOne('/api/sms').error(new ProgressEvent('error'));
      await settle();

      expect(alertText(page)).toContain('could not send your SMS');
      expect(statusText(page)).toBe('');
      expect(router.url).toBe('/send-sms');
    });

    it('clears a server error as soon as the offending field is edited', async () => {
      const page = await sendWith();

      httpMock
        .expectOne('/api/sms')
        .flush(
          { type: PROBLEM.insufficientCredit },
          { status: 402, statusText: 'Payment Required' },
        );
      await settle();
      expect(alertText(page)).toBe(NOT_ENOUGH_CREDIT);

      await fillIn(page, { recipient: '09121234568' });

      expect(alertText(page)).toBe('');
    });
  });
});
