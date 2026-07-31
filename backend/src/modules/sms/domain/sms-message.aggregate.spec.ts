import { Identity } from '@framework/domain';

import { SmsSent } from './events/sms-sent.event';
import { SmsMessage } from './sms-message.aggregate';
import { MessageBody } from './value/message-body';
import { PhoneNumber } from './value/phone-number';
import { ServiceLevel } from './value/service-level';

describe('SmsMessage', () => {
  const SENT_AT = new Date('2026-01-01T00:00:00.000Z');

  const queue = (
    senderId: Identity = Identity.new(),
    recipient = '09121234567',
    body = 'Your order has shipped.',
    serviceLevel = ServiceLevel.standard(),
  ): SmsMessage =>
    SmsMessage.queue(
      senderId,
      PhoneNumber.fromString(recipient),
      MessageBody.fromString(body),
      serviceLevel,
      SENT_AT,
    );

  const queueExpress = (): SmsMessage =>
    queue(
      Identity.new(),
      '09121234567',
      'Your order has shipped.',
      ServiceLevel.express(),
    );

  it('a queued message is given an identity of its own', () => {
    const senderId = Identity.new();
    const sut = queue(senderId);
    expect(sut.id.equals(senderId)).toBe(false);
  });

  it('two queued messages are distinct', () => {
    expect(queue().id.equals(queue().id)).toBe(false);
  });

  it('a queued message records who sent it, to whom, and what it said', () => {
    const senderId = Identity.new();
    const sut = queue(senderId, '09121234567', 'Your order has shipped.');
    expect(sut.toPrimitives()).toEqual({
      id: sut.id.asString(),
      senderId: senderId.asString(),
      recipient: '09121234567',
      body: 'Your order has shipped.',
      status: 'PENDING',
      serviceLevel: 'STANDARD',
      sentAt: SENT_AT,
    });
  });

  /**
   * The state that makes the outbox honest: a message exists, and is paid for,
   * before anyone knows whether the carrier will take it.
   */
  it('a queued message starts PENDING, not SENT', () => {
    const sut = queue();
    expect(sut.toPrimitives()).toMatchObject({ status: 'PENDING' });
    expect(sut.isSent()).toBe(false);
  });

  it('the recipient is stored in its normalised form', () => {
    const sut = queue(Identity.new(), '+989121234567');
    expect(sut.toPrimitives()).toMatchObject({ recipient: '09121234567' });
  });

  /**
   * Announcing a send at acceptance time would tell the rest of the system a
   * message went out while it was still sitting in the outbox.
   */
  it('queueing records no event, because nothing has been sent yet', () => {
    expect(queue().releaseEvents()).toEqual([]);
  });

  it('marking a message sent moves it to SENT', () => {
    const sut = queue();
    sut.markSent();
    expect(sut.toPrimitives()).toMatchObject({ status: 'SENT' });
    expect(sut.isSent()).toBe(true);
  });

  it('marking a message sent records an SmsSent event naming the message, sender and recipient', () => {
    const senderId = Identity.new();
    const sut = queue(senderId);

    sut.markSent();

    expect(sut.releaseEvents()).toEqual([
      new SmsSent(
        sut.id.asString(),
        senderId.asString(),
        '09121234567',
        SENT_AT,
      ),
    ]);
  });

  it('marking a message failed moves it to FAILED', () => {
    const sut = queue();
    sut.markFailed();
    expect(sut.toPrimitives()).toMatchObject({ status: 'FAILED' });
    expect(sut.isSent()).toBe(false);
  });

  /** Nothing downstream has a use for it, and the dead letter is the record. */
  it('marking a message failed records no event', () => {
    const sut = queue();
    sut.markFailed();
    expect(sut.releaseEvents()).toEqual([]);
  });

  it('the time of sending is the one supplied, not the machine clock', () => {
    const sut = queue();
    expect(sut.toPrimitives()).toMatchObject({ sentAt: SENT_AT });
  });

  it('a message records the service level it was sent at', () => {
    expect(queueExpress().toPrimitives()).toMatchObject({
      serviceLevel: 'EXPRESS',
    });
  });

  /**
   * Measured from acceptance, not from dispatch — the promise is made when we
   * take the message, so it does not slide if the carrier is slow to answer.
   */
  it('an express message is guaranteed to reach the operator five minutes after it is accepted', () => {
    expect(queueExpress().guaranteedDeliveryAt()).toEqual(
      new Date('2026-01-01T00:05:00.000Z'),
    );
  });

  it('a standard message carries no delivery guarantee', () => {
    expect(queue().guaranteedDeliveryAt()).toBeUndefined();
  });
});
