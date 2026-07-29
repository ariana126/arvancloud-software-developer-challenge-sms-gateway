import {
  notes,
  Question,
  QuestionAdapter,
  Task,
  Wait,
} from '@serenity-js/core';
import { Ensure, equals, includes } from '@serenity-js/assertions';
import {
  Click,
  Enter,
  isVisible,
  Navigate,
  Page,
  Text,
} from '@serenity-js/web';
import {
  EnsureLoggedIn,
  LogIn,
  TheirOwnCredentials,
} from '../authentication/log-in';
import { AccountNotes } from '../common/notes';
import {
  EnsureAccountCreditIs,
  TheAccountCreditTheyStartedWith,
} from '../credit/account-credit';
import { Form } from '../ui/form';
import { SmsDetails } from './sms-details';
import { LookUpTheCostOfOneSms, TheCostOfOneSms } from './sms-pricing';

/**
 * Sending an SMS is what this product is for, so the one route modelled here is the one a person
 * takes: the browser (BDD in Action, ch10 reason 1). `using` follows the `SignUp.using` /
 * `LogIn.using` idiom — the goal is in the class name, the door is in the method name.
 *
 * There is no `viaApiUsing` yet, deliberately. `view-sent-sms-report.feature`'s passive
 * `Given {actor} has sent an SMS to {string}` is what will want one, and a goal-named class makes
 * that a one-method addition when that feature area is automated.
 *
 * The parameter is a plain `SmsDetails` rather than the usual `Answerable<SmsDetails>`, so the
 * recipient can be read into the task description and the living documentation gets a sentence —
 * "Ariana sends an SMS to 09121234567" — rather than the name of an unresolved adapter. Nothing
 * is lost by it: both fields are known when the step runs, the recipient coming from the scenario
 * and the message from the actor's own name. Anything needing them later reads the notepad
 * through {@link TheSmsTheySent}.
 */
export class SendAnSms {
  static using = (details: SmsDetails): Task =>
    Task.where(
      `#actor sends an SMS to ${details.recipient}`,
      notes<AccountNotes>().set('sms', details),
      LocateTheSendSmsForm(),
      FillInTheSendSmsForm(details),
      SubmitTheSendSmsForm(),
    );
}

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
