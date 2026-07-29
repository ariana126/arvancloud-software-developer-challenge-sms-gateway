/**
 * What this feature calls its fields when the API rejects one.
 *
 * class-validator's wording is written for developers ("password must be longer than or equal to
 * 12 characters"); these are the same rules in the words the forms already use beside each input.
 * Handed to `toSubmissionErrors` per call rather than living in `core/`, so that another feature's
 * idea of a field named `email` or `message` cannot collide with this one's.
 */
export const IDENTITY_FIELD_MESSAGES: Readonly<Record<string, string>> = {
  email: 'Enter a valid email address.',
  password: 'Use at least 12 characters.',
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
};
