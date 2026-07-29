import { MessageBody } from './message-body';

describe('MessageBody', () => {
  it('ordinary text is accepted', () => {
    const sut = MessageBody.fromString('Your order has shipped.');
    expect(sut.asString()).toBe('Your order has shipped.');
  });

  it('surrounding whitespace is ignored', () => {
    const sut = MessageBody.fromString('  Hello  ');
    expect(sut.asString()).toBe('Hello');
  });

  it('an empty body is rejected', () => {
    expect(() => MessageBody.fromString('')).toThrow();
  });

  it('a whitespace-only body is rejected', () => {
    expect(() => MessageBody.fromString(' '.repeat(3))).toThrow();
  });

  it('a body of exactly one GSM segment is accepted', () => {
    const sut = MessageBody.fromString('a'.repeat(160));
    expect(sut.length()).toBe(160);
  });

  it('a body longer than one GSM segment is rejected', () => {
    expect(() => MessageBody.fromString('a'.repeat(161))).toThrow();
  });

  it('two bodies with the same text are equal', () => {
    expect(
      MessageBody.fromString('Hello').equals(MessageBody.fromString('Hello')),
    ).toBe(true);
  });

  it('two bodies with different text are not equal', () => {
    expect(
      MessageBody.fromString('Hello').equals(MessageBody.fromString('Goodbye')),
    ).toBe(false);
  });
});
