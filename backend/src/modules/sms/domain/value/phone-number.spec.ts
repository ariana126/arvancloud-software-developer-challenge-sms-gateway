import { PhoneNumber } from './phone-number';

describe('PhoneNumber', () => {
  it.each([
    ['the local form', '09121234567'],
    ['the international form', '+989121234567'],
    ['a number padded with whitespace', '  09121234567  '],
  ])('%s is stored as one normalised local number', (_case, value) => {
    expect(PhoneNumber.fromString(value).asString()).toBe('09121234567');
  });

  it.each([
    ['a landline number', '02112345678'],
    ['a number with too few digits', '0912123456'],
    ['a number with too many digits', '091212345678'],
    ['a number punctuated between its digits', '0912-123-4567'],
    ['a non-Iranian international number', '+447911123456'],
    ['no number at all', ' '.repeat(3)],
  ])('%s is rejected', (_case, value) => {
    expect(() => PhoneNumber.fromString(value)).toThrow();
  });

  it('the two spellings of one number are the same value', () => {
    const local = PhoneNumber.fromString('09121234567');
    const international = PhoneNumber.fromString('+989121234567');
    expect(local.equals(international)).toBe(true);
  });

  it('two different numbers are not equal', () => {
    expect(
      PhoneNumber.fromString('09121234567').equals(
        PhoneNumber.fromString('09127654321'),
      ),
    ).toBe(false);
  });
});
