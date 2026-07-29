import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FieldTree, form, pattern, required, submit, validate } from '@angular/forms/signals';

import { toProblemDetails } from '../../../core/http/problem-details';
import { toSubmissionErrors } from '../../../core/http/server-errors';
import { SmsGateway } from '../../../core/sms/sms-gateway';
import { CheckboxField } from '../../../ui/checkbox-field/checkbox-field';
import { TextField } from '../../../ui/text-field/text-field';

const SEND_FAILED = 'We could not send your SMS. Check your connection and try again.';

/**
 * Copied from `SendSmsDto.recipient`'s `pattern` in `api/openapi.json` — an Iranian mobile number in
 * local (09121234567) or international (+989121234567) form.
 *
 * Mirroring a server rule client-side is normally how the two drift, which is why the sign-up page
 * deliberately does *not* tighten its email rule to match. This one is different: the contract
 * publishes the regex itself, it lives in this project, and `make lint-api-contract` fails when the
 * copy goes stale. The 400 is still mapped back onto this field regardless, so a rule that does
 * drift surfaces under the input rather than vanishing.
 */
const RECIPIENT_PATTERN = /^(?:09\d{9}|\+989\d{9})$/;

/** One GSM segment, per `SendSmsDto.message`'s `maxLength`. */
const MAXIMUM_MESSAGE_LENGTH = 160;

const TOO_LONG = `Keep your message to ${MAXIMUM_MESSAGE_LENGTH} characters or fewer.`;

/** What this feature calls its fields when the API rejects one. See `core/http/server-errors.ts`. */
const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  recipient: 'Enter an Iranian mobile number, like 09121234567.',
  message: TOO_LONG,
};

@Component({
  selector: 'app-send-sms-page',
  imports: [CheckboxField, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './send-sms-page.html',
  styleUrl: './send-sms-page.css',
})
export class SendSmsPage {
  private readonly sms = inject(SmsGateway);
  private readonly injector = inject(Injector);

  /**
   * The form's own shape, which happens to match the API's DTO here but is not typed as it: the
   * model is what the page holds, and the gateway call is where the compiler checks it against the
   * contract. Never `null` or `undefined`.
   */
  protected readonly model = signal({ recipient: '', message: '', express: false });

  protected readonly f = form(this.model, (path) => {
    required(path.recipient, { message: 'Enter the number to send to.' });
    pattern(path.recipient, RECIPIENT_PATTERN, {
      message: 'Enter an Iranian mobile number, like 09121234567.',
    });
    required(path.message, { message: 'Write the message you want to send.' });
    // `validate()` rather than `maxLength()`, deliberately. `maxLength()` makes [formField] write a
    // real `maxlength` DOM attribute, and the browser then silently truncates a pasted message at
    // 160 characters — destroying the user's text and making the rule unreachable. A rule that eats
    // input is worse than no rule. jsdom enforces no such attribute, so nothing in this spec file
    // would notice the difference; do not "simplify" this back to maxLength().
    validate(path.message, ({ value }) =>
      value().length > MAXIMUM_MESSAGE_LENGTH
        ? { kind: 'maxlength', message: TOO_LONG }
        : undefined,
    );
    // `path.express` carries no rule at all, and that is deliberate twice over. There is no invalid
    // value — false is an answer, not a blank — and `required()` on a checkbox is the same trap as
    // `maxLength()` above: it makes [formField] write a real `required` attribute, and a real browser
    // then refuses to submit the form until the box is ticked. Express is opt-in. jsdom enforces no
    // constraint validation, so nothing in this spec file would notice; do not add a rule here.
  });

  /**
   * The price of one message, for the hint beside the button.
   *
   * `rxResource` wraps the gateway's Observable into signal state, which is what `orval.config.ts`
   * prescribes for reads that want a signal. Note `stream:`, not `loader:`.
   */
  protected readonly pricing = rxResource({ stream: () => this.sms.pricing() });

  /**
   * Empty while the price is loading, and empty if it never arrives — never a broken sentence.
   *
   * The `error()` check has to come first and is not defensive padding: `value()` **rethrows** the
   * failure when the resource is in an error state, and this computed is read during change
   * detection, so a failed price request would take the whole page down with it. `ProfilePage`
   * avoids the same trap by branching on `error()` in its template before reading the value.
   */
  protected readonly priceHint = computed(() => {
    if (this.pricing.error() !== undefined) {
      return '';
    }

    const price = this.pricing.value();
    if (price === undefined || price.costPerSms <= 0 || price.currency === '') {
      return '';
    }

    return `Each message costs ${price.costPerSms.toLocaleString('en-US')} ${price.currency}.`;
  });

  /**
   * The recipient of the message that was just sent, or '' when nothing has been.
   *
   * A plain component signal rather than anything the form owns, and that is the point: root
   * submission errors live in a `linkedSignal` sourced on the model, so they evaporate on the next
   * edit — right for the credit banner, fatal for a confirmation that has to outlive the form reset
   * happening immediately after it.
   */
  protected readonly sentTo = signal('');

  /**
   * The ISO-8601 instant the message just sent is guaranteed by, or '' when nothing was promised —
   * which is every standard send.
   *
   * A plain component signal for exactly the reason `sentTo` is one, and the reason is worth repeating
   * rather than cross-referencing: anything the form owns lives in a `linkedSignal` sourced on the
   * model, so it evaporates on the next edit. This value has to survive the `reset()` that happens
   * one line after it is set.
   */
  protected readonly guaranteedBy = signal('');

  /**
   * The same instant as something a person reads. Empty whenever `guaranteedBy` is, so one check
   * governs both halves of the guarantee and a standard send can render neither.
   *
   * Only the clock time, not the date: the promise is minutes away, so the date would be noise on
   * every single send. Nothing is lost by leaving it out, because the full instant is published in
   * the `<time datetime>` beside it — which is the attribute anything machine-readable should be
   * reading anyway.
   */
  protected readonly guaranteedByText = computed(() => {
    const instant = this.guaranteedBy();
    if (instant === '') {
      return '';
    }

    return new Date(instant).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  });

  /** Errors with no field of their own — the ones the alert banner shows. */
  protected readonly formErrors = computed(() =>
    this.f()
      .errors()
      .map((error) => error.message)
      .filter((message): message is string => message !== undefined),
  );

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();

    // Cleared first, so a confirmation from the previous message cannot sit beside a failing one —
    // and so that a non-empty value below can only mean *this* attempt succeeded.
    this.sentTo.set('');
    this.guaranteedBy.set('');

    await submit(this.f, async () => {
      const { recipient, message, express } = this.model();

      try {
        const receipt = await this.sms.sendSms({ recipient, message, express });
        this.guaranteedBy.set(receipt.guaranteedDeliveryAt);
      } catch (error) {
        return toSubmissionErrors(toProblemDetails(error), {
          targets: { recipient: this.f.recipient, message: this.f.message },
          fieldMessages: FIELD_MESSAGES,
          fallback: SEND_FAILED,
        });
      }

      this.sentTo.set(recipient);
      return undefined;
    });

    if (this.sentTo() !== '') {
      // Emptied because the next thing this page is for is a *different* message, and leaving the
      // last one in place puts an accidental duplicate — a second charge — one keystroke away.
      // `reset()` is what keeps the now-empty required fields from reporting themselves: it clears
      // the touched and submitted state that would otherwise make them show errors immediately.
      // `express` goes back to false with them: it is a per-message choice, and a box left ticked
      // would send the next message express without anyone having asked for it. Not a matter of cost
      // — express is priced the same — but of a promise being made on the sender's behalf.
      this.model.set({ recipient: '', message: '', express: false });
      this.f().reset();
      return;
    }

    this.moveFocusToFirstError();
  }

  /**
   * `submit()` has settled both client and server errors by the time it resolves, so one pass
   * handles either. `errorSummary()` is ordered by document position, which is what makes "the first
   * invalid field" simply the first entry.
   *
   * Duplicated from the two identity pages rather than hoisted: a third copy is the point at which
   * extracting starts to pay, but doing it here would mean editing those pages twice in one change.
   * When a fourth page wants this, move it.
   */
  private moveFocusToFirstError(): void {
    const firstFieldError = this.f()
      .errorSummary()
      .find((error) => error.fieldTree !== undefined && error.fieldTree !== this.f);

    if (firstFieldError !== undefined) {
      (firstFieldError.fieldTree as FieldTree<string>)().focusBoundControl();
      return;
    }

    if (this.formErrors().length > 0) {
      // `afterNextRender`, not a bare `focus()`, and this is a browser-only distinction that jsdom
      // cannot show you. The banner is styled `.alert:empty { display: none }`, so at this instant
      // — the error signal set, the DOM not yet updated, because the app is zoneless and change
      // detection is scheduled rather than synchronous — the element is still display:none, and
      // focusing a display:none element is a silent no-op in a real browser. Focus went nowhere.
      // Waiting for the render that reveals the banner is what makes the call land.
      afterNextRender(() => document.getElementById('send-sms-alert')?.focus(), {
        injector: this.injector,
      });
    }
  }
}
