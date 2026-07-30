import {
  notes,
  Question,
  QuestionAdapter,
  Task,
  Wait,
} from '@serenity-js/core';
import { Ensure, equals, includes, isAfter } from '@serenity-js/assertions';
import {
  Attribute,
  Click,
  Enter,
  isVisible,
  Navigate,
  Page,
  Text,
} from '@serenity-js/web';
import { LastResponse, PostRequest, Send } from '@serenity-js/rest';
import {
  EnsureLoggedIn,
  LogIn,
  TheirBearerToken,
  TheirOwnCredentials,
} from '../authentication/log-in';
import { FreezeTimeAt, theMomentScenariosFreezeTimeAt } from '../common/clock';
import { AccountNotes } from '../common/notes';
import {
  EnsureAccountCreditIs,
  TheAccountCreditTheyStartedWith,
} from '../credit/account-credit';
import { Form } from '../ui/form';
import { SmsDetails } from './sms-details';
import {
  LookUpTheCostOfOneSms,
  StartWithJustEnoughCreditForOneSms,
  TheCostOfOneSms,
} from './sms-pricing';

/**
 * Sending an SMS is what this product is for, so the route the scenarios *demonstrating* it take
 * is the one a person takes: the browser (BDD in Action, ch10 reason 1). `using` follows the
 * `SignUp.using` / `LogIn.using` idiom — the goal is in the class name, the door is in the method
 * name — and `viaApiUsing` is its passive counterpart, added for
 * `view-sent-sms-report.feature`'s `Given {actor} has sent an SMS to {string}`, where we care only
 * *that* the message went out. Exactly the one-method addition the goal-named class was left open
 * for.
 *
 * The parameter is a plain `SmsDetails` rather than the usual `Answerable<SmsDetails>`, so the
 * recipient can be read into the task description and the living documentation gets a sentence —
 * "Ariana sends an SMS to 09121234567" — rather than the name of an unresolved adapter. Nothing
 * is lost by it: both fields are known when the step runs, the recipient coming from the scenario
 * and the message from the actor's own name. Anything needing them later reads the notepad
 * through {@link TheSmsTheySent}.
 *
 * **Express is a service level, so it arrives in `details` rather than in a second method.** The
 * reasoning is in `sms-details.ts`; the consequence here is that `using` remains the single entry
 * point and the two express-only activities are ordinary conditionals. They can be, precisely
 * because `details` is a plain object rather than an answerable — the service level is known while
 * the task is being *built*, so no `Check.whether` is needed and the description can say "express"
 * out loud.
 */
export class SendAnSms {
  static using = (details: SmsDetails): Task => {
    const express = details.serviceLevel === 'express';

    return Task.where(
      `#actor sends an${express ? ' express' : ''} SMS to ${details.recipient}`,
      notes<AccountNotes>().set('sms', details),
      // **Order is load-bearing: the clock is fixed before anything logs in.** `LocateTheSendSmsForm`
      // signs the actor in through the browser, and `JwtAuthGuard` verifies tokens against the same
      // injected clock with a one-hour life. Jumping the clock forward *after* a login would
      // therefore invalidate the session mid-scenario. Every `Given` above has already spent its own
      // API token by now, so the top of the send is the safe moment. Do not reorder these.
      ...(express ? [FixTheMomentOfSending()] : []),
      LocateTheSendSmsForm(),
      FillInTheSendSmsForm(details),
      ...(express ? [ChooseExpressDelivery()] : []),
      SubmitTheSendSmsForm(),
    );
  };

  /**
   * Posts the details, and nothing else — no funding, no clock. Keeping it that way is what lets a
   * scenario asserting a deduction use it without an invisible top-up moving the balance
   * underneath it; establishing the credit is {@link HaveAlreadySentAnSms}'s job, above the send
   * rather than inside it.
   *
   * Contract: `POST sms`, bearer-authenticated, body `{ recipient, message, serviceLevel? }`,
   * `201 { id, cost, guaranteedDeliveryAt? }`. The same arrangement as the credit and pricing
   * tasks: this door has no browser to carry a session, so the actor logs in immediately
   * beforehand and reads the token off that response.
   */
  static viaApiUsing = (details: SmsDetails): Task =>
    Task.where(
      `#actor sends an${details.serviceLevel === 'express' ? ' express' : ''} SMS to ${details.recipient} (via the API)`,
      notes<AccountNotes>().set('sms', details),
      LogIn.viaApiUsing(TheirOwnCredentials()),
      Send.a(
        PostRequest.to('sms')
          .with(theSendSmsRequestBody(details))
          .using({ headers: { Authorization: TheirBearerToken() } }),
      ),
      // A precondition that fails to establish itself is the worst kind — the same reasoning as
      // `AddCredit`. Without this, an unfunded or rejected send would surface much later as an
      // empty report, which reads like the isolation rule working.
      Ensure.that(LastResponse.status(), equals(201)),
    );
}

/**
 * What goes on the wire, which is **not** `SmsDetails`.
 *
 * Two mismatches, both enforced by `SendSmsDto`, and neither visible from the domain type:
 * the API's service-level codes are upper case (`@IsIn(['STANDARD', 'EXPRESS'])`) where the domain
 * word is lower case, and `forbidNonWhitelisted` is on, so an unrecognised value is a `400` rather
 * than something quietly ignored. A standard send omits the field altogether instead of sending
 * `STANDARD`: the DTO makes it optional and the controller applies the default, so leaving it out
 * exercises the API the way a real client would.
 *
 * The translation lives here, at the edge, rather than changing `SmsDetails` — the domain type is
 * read by the UI route too, where "express" is a checkbox and no wire code exists.
 */
const theSendSmsRequestBody = (details: SmsDetails) => ({
  recipient: details.recipient,
  message: details.message,
  ...(details.serviceLevel === 'express'
    ? { serviceLevel: 'EXPRESS' as const }
    : {}),
});

/**
 * The precondition behind `Given {actor} has sent an SMS to {string}` — an actor who has *already*
 * sent one.
 *
 * It funds the send itself, and that is the point of it existing at all. `send-sms.feature` and
 * `send-express-sms.feature` both open by granting credit; `view-sent-sms-report.feature`'s
 * Background says only that Ariana is registered, and a freshly registered actor's balance is 0 —
 * so a bare `POST sms` would come back `402 insufficient-credit` and the precondition would never
 * establish. A `Given` may do whatever it takes to make its statement true, provided it goes
 * through the front door, and topping up is an ordinary API call this suite already models.
 *
 * "Just enough for one SMS" rather than a round figure: the scenario states no balance, so
 * inventing one would put a number in the automation that the Gherkin declined to state.
 */
export const HaveAlreadySentAnSms = (details: SmsDetails): Task =>
  Task.where(
    `#actor has already sent an SMS to ${details.recipient}`,
    StartWithJustEnoughCreditForOneSms(),
    SendAnSms.viaApiUsing(details),
  );

/**
 * Pins the backend clock at `theMomentScenariosFreezeTimeAt` and remembers it in the notepad, so
 * that "the guarantee is later than the send" can be asserted against the system's own timeline
 * rather than against the host's wall clock — which sits months *ahead* of the instant the backend
 * starts every scenario frozen at, and would make a perfectly correct future guarantee look past.
 *
 * This is the one call site `screenplay/common/clock.ts` was waiting for.
 */
const FixTheMomentOfSending = (): Task =>
  Task.where(
    `#actor fixes the moment of sending at ${theMomentScenariosFreezeTimeAt}`,
    FreezeTimeAt(theMomentScenariosFreezeTimeAt),
    notes<AccountNotes>().set('sentAt', theMomentScenariosFreezeTimeAt),
  );

/**
 * The one extra thing an express sender does on the form. It sits beside filling the form rather
 * than inside it, so the report shows choosing express as a business step of its own.
 *
 * A `Click` because `@serenity-js/web` has no `Check`/`Tick` interaction — and because clicking is
 * what a person does to a checkbox. The control starts unchecked, so this is a select and not a
 * toggle; if it ever ships checked by default, this silently turns express *off*.
 */
const ChooseExpressDelivery = (): Task =>
  Task.where(
    '#actor chooses express delivery',
    Click.on(Form.checkboxFor('Express delivery')),
  );

/**
 * Opening this page is more than a navigation: **the browser has no session yet**. Every `Given`
 * in these scenarios logs in over the API, which leaves the token in the HTTP client rather than
 * in `localStorage` — and each actor gets their own, empty browser context. So the actor signs in
 * the way a person would, because otherwise `/send-sms` will not let them in at all.
 *
 * `Navigate.to('/')` first is what makes that possible: `LogIn.using` reaches the form by clicking
 * the header's "Log in" link on whatever page is already open, and would find nothing at
 * `about:blank` (see CLAUDE.md — this is the documented way that fails). `EnsureLoggedIn` is
 * load-bearing rather than decorative: it waits for the app to land on `/profile`, which is the
 * app's own signal that the token has been stored, so the navigation below cannot race ahead of
 * it and bounce off the auth guard.
 *
 * The final wait belongs here, in the *locate* task, so that filling the form can simply type.
 */
const LocateTheSendSmsForm = (): Task =>
  Task.where(
    '#actor locates the send-SMS form',
    Navigate.to('/'),
    LogIn.using(TheirOwnCredentials()),
    EnsureLoggedIn(),
    Navigate.to('/send-sms'),
    Wait.until(Form.inputFor('Recipient number'), isVisible()),
  );

const FillInTheSendSmsForm = (details: SmsDetails): Task =>
  Task.where(
    '#actor fills in the send-SMS form',
    Enter.theValue(details.recipient).into(Form.inputFor('Recipient number')),
    Enter.theValue(details.message).into(Form.inputFor('Message')),
  );

const SubmitTheSendSmsForm = (): Task =>
  Task.where(
    '#actor submits the send-SMS form',
    Click.on(Form.buttonCalled('Send SMS')),
  );

/**
 * What the actor sent, read back from the notepad so the confirmation can be checked against the
 * recipient they actually typed rather than a number repeated inside the assertion.
 */
export const TheSmsTheySent = (): QuestionAdapter<SmsDetails> =>
  notes<AccountNotes>().get('sms');

const TheConfirmationTheyExpect = (): QuestionAdapter<string> =>
  Question.about('the confirmation they expect', async (actor) => {
    const sms = await actor.answer(TheSmsTheySent());
    return `Your SMS has been sent to ${sms.recipient}`;
  });

/**
 * Asserted through the UI, because the rule this scenario documents is about the screen: the point
 * of a successful send is that the sender is *told* it happened, and told who it went to — hence
 * the recipient in the expected copy rather than a bare "Sent".
 *
 * Staying on `/send-sms` is asserted too. That is what distinguishes "confirmed" from "the message
 * flashed on the way somewhere else".
 */
export const EnsureSmsSent = (): Task =>
  Task.where(
    '#actor ensures the SMS was sent successfully',
    Wait.until(Form.confirmation(), isVisible()),
    Ensure.that(
      Text.of(Form.confirmation()),
      includes(TheConfirmationTheyExpect()),
    ),
    Ensure.that(Page.current().url().pathname, equals('/send-sms')),
  );

/**
 * The moment the send happened — a notepad read of the instant {@link FixTheMomentOfSending} froze
 * the clock at. No request, so it is safe anywhere.
 *
 * A `Date` rather than epoch milliseconds because `isAfter` takes `Answerable<Timestamp | Date>`,
 * so the comparison can read as the time comparison it actually is instead of as arithmetic.
 */
export const TheMomentTheySent = (): QuestionAdapter<Date> =>
  Question.about(
    'the moment they sent the SMS',
    async (actor) =>
      new Date(await actor.answer(notes<AccountNotes>().get('sentAt'))),
  );

/**
 * The instant the confirmation promises the message will reach the operator by.
 *
 * Read from the `datetime` **attribute**, never from the rendered text. That is the whole point of
 * asking the frontend for a `<time datetime="…">`: the visible copy is free to be localised,
 * reformatted or reworded without this question changing, and an ISO-8601 instant parses
 * unambiguously where "09:05 on 1 January 2026" does not.
 */
export const TheGuaranteedDeliveryTime = (): QuestionAdapter<Date> =>
  Question.about(
    'the guaranteed delivery time to the operator',
    async (actor) =>
      new Date(
        await actor.answer(
          Attribute.called('datetime').of(Form.deliveryGuarantee()),
        ),
      ),
  );

/**
 * Express's whole point: the sender is told *when* the message is guaranteed to reach the operator.
 *
 * Asserted through the UI, because being told is the claim. Three things, in order: the guarantee is
 * on screen; the banner says in words a person reads what that time *means*, so this cannot pass on
 * a stray `<time>` element alone; and the instant it promises is genuinely later than the moment the
 * send happened, so an empty or epoch-defaulted attribute fails.
 *
 * **The length of the guarantee window is deliberately not asserted.** The scenario says "the
 * guaranteed delivery time", not "within five minutes" — asserting a figure the Gherkin declines to
 * state would put a product constant in the automation layer, and computing it from a window the
 * backend also published would only prove the suite can repeat the backend's own arithmetic.
 *
 * Only the fixed phrase is asserted, not the formatted date: reproducing the frontend's date
 * rendering here would couple the suite to a presentation decision and break on every copy tweak.
 */
export const EnsureGuaranteedDeliveryTimeShown = (): Task =>
  Task.where(
    '#actor ensures they are shown the guaranteed delivery time to the operator',
    Wait.until(Form.deliveryGuarantee(), isVisible()),
    Ensure.that(
      Text.of(Form.confirmation()),
      includes('reach the operator by'),
    ),
    Ensure.that(TheGuaranteedDeliveryTime(), isAfter(TheMomentTheySent())),
  );

/**
 * Also asserted through the UI, and for the same reason. The banner rather than a field: running
 * out of credit is nothing the recipient or message inputs did wrong, so there is no offending
 * input to put it beside.
 *
 * The backend's `402 insufficient-credit` envelope is deliberately not checked — per this suite's
 * conventions the shape of an error response belongs to the backend's own tests once a scenario
 * has moved to watching the screen.
 */
export const EnsureSendRejectedForInsufficientCredit = (): Task =>
  Task.where(
    '#actor ensures the send was rejected for insufficient credit',
    Wait.until(Form.errorSummary(), isVisible()),
    Ensure.that(
      Text.of(Form.errorSummary()),
      includes('You do not have enough credit to send this SMS'),
    ),
    Ensure.that(Page.current().url().pathname, equals('/send-sms')),
  );

/** Two notepad reads and a subtraction. No request, so nothing here disturbs `LastResponse`. */
export const TheAccountCreditTheyStartedWithLessTheCostOfOneSms =
  (): QuestionAdapter<number> =>
    Question.about(
      'their account credit less the cost of one SMS',
      async (actor) => {
        const startingCredit = await actor.answer(
          TheAccountCreditTheyStartedWith(),
        );
        const costOfOneSms = await actor.answer(TheCostOfOneSms());
        return startingCredit - costOfOneSms;
      },
    );

/**
 * The price is looked up *before* the balance is fetched, so by the time the assertion runs,
 * `LastResponse` is unambiguously the credit response — and the expected value it is compared
 * against came from the notepad rather than from a request racing it.
 */
export const EnsureTheCostOfOneSmsWasDeducted = (): Task =>
  Task.where(
    '#actor ensures the cost of one SMS was deducted from their account credit',
    LookUpTheCostOfOneSms(),
    EnsureAccountCreditIs(TheAccountCreditTheyStartedWithLessTheCostOfOneSms()),
  );

/**
 * Expressed as "what they started with" rather than a literal 0: the scenario's `Given` already
 * says what the balance was, and this step's claim is that the failed send changed nothing.
 */
export const EnsureNoCostWasDeducted = (): Task =>
  Task.where(
    '#actor ensures no cost was deducted from their account credit',
    EnsureAccountCreditIs(TheAccountCreditTheyStartedWith()),
  );
