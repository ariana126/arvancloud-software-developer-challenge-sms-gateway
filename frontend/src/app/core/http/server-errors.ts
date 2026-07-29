import { FieldTree, ValidationError } from '@angular/forms/signals';

import { PROBLEM, ProblemDetails } from './problem-details';

/**
 * The form fields a server error can be attributed to, keyed by the name the API uses for them.
 * The backend reports `errors[].field` as the DTO property name, so these keys are `email`,
 * `password`, `recipient`, `message` — identical to each form's own field names, which is why no
 * translation table is needed.
 */
export type FieldTargets = Readonly<Record<string, FieldTree<string> | undefined>>;

/** Marks an error as having come from the API rather than from a client-side rule. */
export const SERVER_ERROR_KIND = 'server';

/**
 * What a caller tells the mapper about itself.
 *
 * `fieldMessages` is passed in rather than living here on purpose. class-validator's wording is
 * written for developers ("password must be longer than or equal to 12 characters"), so a form
 * replaces the messages for rules it already states in its own words — but which words depend on
 * the form. A module-level table keyed by bare field name would have every form sharing one entry
 * for `message`, a field name generic enough that two features are bound to disagree about it.
 * Anything not listed passes through unchanged, so a rule the backend adds later still surfaces
 * rather than vanishing.
 */
export interface ServerErrorMapping {
  readonly targets: FieldTargets;
  readonly fieldMessages?: Readonly<Record<string, string>>;
  /** Shown on the form root when nothing more specific can be said. */
  readonly fallback: string;
}

/**
 * Turns an API failure into validation errors a signal form can display.
 *
 * An error carrying a `fieldTree` renders under that field; one without it lands on the form root,
 * which is what the `role="alert"` banner shows. That distinction is the whole design: a problem the
 * user can fix in a specific input belongs beside that input, and everything else belongs in one
 * place where it cannot be missed.
 *
 * This sits in `core/` rather than in a feature because `validation-error` is emitted by every
 * endpoint in the contract, and duplicating the `errors[]` handling per feature is how two copies
 * drift on the subtlest part of it. The per-type sentences below are the app's whole vocabulary of
 * API failures, which is why they read as belonging to several features at once.
 *
 * Branching is on `type` only. `detail` is optional per RFC 9457, and its wording belongs to the
 * server — the messages here are written client-side so the UI controls its own voice.
 */
export function toSubmissionErrors(
  problem: ProblemDetails | undefined,
  mapping: ServerErrorMapping,
): ValidationError.WithOptionalFieldTree[] {
  if (problem === undefined) {
    // Not a problem document at all: a dropped connection, an HTML error page from a proxy, or a
    // failure thrown by our own code. Nothing field-specific can be said.
    return [formError(mapping.fallback)];
  }

  switch (problem.type) {
    case PROBLEM.validationError:
      return validationErrors(problem, mapping);

    case PROBLEM.userAlreadyExists:
      // The 409 carries no `errors` array — the API states the conflict in its own member. Email is
      // the only field it can be about, so the binding is made explicitly here.
      return [
        fieldError(
          'An account with this email already exists. Log in instead, or use another address.',
          mapping.targets['email'],
        ),
      ];

    case PROBLEM.invalidCredentials:
      // Deliberately a form-level error, not one on the email field. Saying which half was wrong
      // tells an attacker which addresses are registered.
      return [formError('Email or password is incorrect.')];

    case PROBLEM.insufficientCredit:
      // Product-visible copy, fixed word for word. The 402 also carries `required` and `available`
      // as extension members; neither is read, because the sentence the user sees is ours and does
      // not quote amounts. Do not append a full stop — this string is the contract.
      return [formError('You do not have enough credit to send this SMS')];

    case PROBLEM.concurrentModification:
      // The balance moved under the request. Nothing was charged and the same attempt can simply be
      // made again, which the generic fallback would describe as a connection problem instead.
      return [formError('Your credit was being updated at the same time. Try sending again.')];

    default:
      return [formError(mapping.fallback)];
  }
}

function validationErrors(
  problem: ProblemDetails,
  mapping: ServerErrorMapping,
): ValidationError.WithOptionalFieldTree[] {
  const errors = problem.errors ?? [];
  if (errors.length === 0) {
    return [formError(mapping.fallback)];
  }

  return errors.map((error) => {
    const field = error.field ?? '';
    // A field the form does not have — the API validating something we do not render — still has to
    // be reported. Without a target it becomes a form-level error rather than disappearing.
    return fieldError(
      mapping.fieldMessages?.[field] ?? error.message ?? mapping.fallback,
      mapping.targets[field],
    );
  });
}

function formError(message: string): ValidationError.WithOptionalFieldTree {
  return { kind: SERVER_ERROR_KIND, message };
}

function fieldError(
  message: string,
  fieldTree: FieldTree<string> | undefined,
): ValidationError.WithOptionalFieldTree {
  return fieldTree === undefined
    ? formError(message)
    : { kind: SERVER_ERROR_KIND, message, fieldTree };
}
