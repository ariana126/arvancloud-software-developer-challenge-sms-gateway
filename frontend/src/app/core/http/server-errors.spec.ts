import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form, FieldTree } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import { PROBLEM, ProblemDetails } from './problem-details';
import { FieldTargets, SERVER_ERROR_KIND, toSubmissionErrors } from './server-errors';

const FALLBACK = 'We could not complete that. Try again.';

/** What an identity form passes in — the wording it already states beside its own fields. */
const MESSAGES = {
  email: 'Enter a valid email address.',
  password: 'Use at least 12 characters.',
};

describe('toSubmissionErrors', () => {
  let targets: FieldTargets;
  let emailField: FieldTree<string>;
  let passwordField: FieldTree<string>;

  beforeEach(() => {
    // `form()` injects, so it only works inside an injection context — in a component that is the
    // field initializer, and here it has to be arranged explicitly.
    const model = TestBed.runInInjectionContext(() => form(signal({ email: '', password: '' })));
    emailField = model.email;
    passwordField = model.password;
    targets = { email: emailField, password: passwordField };
  });

  function map(problem: ProblemDetails | undefined) {
    return toSubmissionErrors(problem, { targets, fieldMessages: MESSAGES, fallback: FALLBACK });
  }

  describe('a validation error', () => {
    it('lands each field problem on the field it names', () => {
      const errors = map({
        type: PROBLEM.validationError,
        errors: [
          { field: 'email', message: 'email must be an email' },
          { field: 'password', message: 'password must be longer than or equal to 12 characters' },
        ],
      });

      expect(errors).toHaveLength(2);
      expect(errors[0].fieldTree).toBe(emailField);
      expect(errors[1].fieldTree).toBe(passwordField);
      expect(errors.every((error) => error.kind === SERVER_ERROR_KIND)).toBe(true);
    });

    it('rewrites the API wording into something written for the person reading it', () => {
      const [error] = map({
        type: PROBLEM.validationError,
        errors: [
          { field: 'password', message: 'password must be longer than or equal to 12 characters' },
        ],
      });

      expect(error.message).toBe('Use at least 12 characters.');
    });

    it('passes through the message for a rule the caller has no wording for', () => {
      const [error] = map({
        type: PROBLEM.validationError,
        errors: [{ field: 'nickname', message: 'nickname is rude' }],
      });

      // Unknown to the form, so it cannot be bound — but it must still be said.
      expect(error.message).toBe('nickname is rude');
      expect(error.fieldTree).toBeUndefined();
    });

    it('lets each caller name the same field differently', () => {
      // The point of passing the table in: `message` is a field name generic enough that two
      // features would otherwise fight over one global entry for it.
      const problem: ProblemDetails = {
        type: PROBLEM.validationError,
        errors: [{ field: 'message', message: 'message must be shorter than 161 characters' }],
      };

      const [sms] = toSubmissionErrors(problem, {
        targets,
        fieldMessages: { message: 'Keep your message to 160 characters or fewer.' },
        fallback: FALLBACK,
      });

      expect(sms.message).toBe('Keep your message to 160 characters or fewer.');
      expect(map(problem)[0].message).toBe('message must be shorter than 161 characters');
    });

    it('falls back to the form when the array is missing or empty', () => {
      const missing = map({ type: PROBLEM.validationError });
      const empty = map({ type: PROBLEM.validationError, errors: [] });

      expect(missing[0]).toEqual({ kind: SERVER_ERROR_KIND, message: FALLBACK });
      expect(empty[0]).toEqual({ kind: SERVER_ERROR_KIND, message: FALLBACK });
    });
  });

  describe('a duplicate email', () => {
    it('lands on the email field, even though the 409 carries no field list', () => {
      const [error] = map({ type: PROBLEM.userAlreadyExists, email: 'ariana@example.com' });

      expect(error.fieldTree).toBe(emailField);
      expect(error.message).toContain('already exists');
    });

    it('does not echo the API detail, whose wording the UI does not control', () => {
      const [error] = map({
        type: PROBLEM.userAlreadyExists,
        detail: 'User already exists with email ariana@example.com',
      });

      expect(error.message).not.toContain('User already exists with email');
    });
  });

  describe('rejected credentials', () => {
    it('stays on the form rather than naming a field, so it reveals no registered address', () => {
      const [error] = map({ type: PROBLEM.invalidCredentials });

      expect(error.fieldTree).toBeUndefined();
      expect(error.message).toBe('Email or password is incorrect.');
    });
  });

  describe('not enough credit', () => {
    it('says so on the form, word for word, because that sentence is product copy', () => {
      // The 402's `required` and `available` members are deliberately absent from ProblemDetails:
      // nothing reads them, because the sentence below quotes no amounts.
      const errors = map({ type: PROBLEM.insufficientCredit });

      expect(errors).toEqual([
        { kind: SERVER_ERROR_KIND, message: 'You do not have enough credit to send this SMS' },
      ]);
    });

    it('does not echo the API detail, which quotes amounts in the server voice', () => {
      const [error] = map({
        type: PROBLEM.insufficientCredit,
        detail: 'Sending an SMS costs 1000, but the sender has only 400.',
      });

      expect(error.message).not.toContain('Sending an SMS costs');
    });
  });

  describe('a concurrent modification', () => {
    it('names the real cause and invites a retry, rather than blaming the connection', () => {
      const [error] = map({ type: PROBLEM.concurrentModification });

      expect(error.fieldTree).toBeUndefined();
      expect(error.message).toBe(
        'Your credit was being updated at the same time. Try sending again.',
      );
    });
  });

  describe('anything else', () => {
    it('reports the fallback on the form when the failure is not a problem document', () => {
      expect(map(undefined)).toEqual([{ kind: SERVER_ERROR_KIND, message: FALLBACK }]);
    });

    it('reports the fallback for a problem type the client does not recognise', () => {
      expect(map({ type: 'https://my-api-doc.dev/problems/teapot' })).toEqual([
        { kind: SERVER_ERROR_KIND, message: FALLBACK },
      ]);
    });
  });
});
