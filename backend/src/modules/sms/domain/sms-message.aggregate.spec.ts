import { Identity } from '@framework/domain';

import { SmsSent } from './events/sms-sent.event';
import { SmsMessage } from './sms-message.aggregate';
import { MessageBody } from './value/message-body';
import { PhoneNumber } from './value/phone-number';
import { ServiceLevel } from './value/service-level';

describe('SmsMessage', () => {
  const SENT_AT = new Date('2026-01-01T00:00:00.000Z');

  const send = (
    senderId: Identity = Identity.new(),
    recipient = '09121234567',
    body = 'Your order has shipped.',
    serviceLevel = ServiceLevel.standard(),
  ): SmsMessage =>
    SmsMessage.send(
      senderId,
      PhoneNumber.fromString(recipient),
      MessageBody.fromString(body),
      serviceLevel,
      SENT_AT,
    );

  const sendExpress = (): SmsMessage =>
    send(
      Identity.new(),
      '09121234567',
      'Your order has shipped.',
      ServiceLevel.express(),
    );

  it('a sent message is given an identity of its own', () => {
    const senderId = Identity.new();
    const sut = send(senderId);
    expect(sut.id.equals(senderId)).toBe(false);
  });

  it('two sent messages are distinct', () => {
    expect(send().id.equals(send().id)).toBe(false);
  });

  it('a sent message records who sent it, to whom, and what it said', () => {
    const senderId = Identity.new();
    const sut = send(senderId, '09121234567', 'Your order has shipped.');
    expect(sut.toPrimitives()).toEqual({
      id: sut.id.asString(),
      senderId: senderId.asString(),
      recipient: '09121234567',
      body: 'Your order has shipped.',
      status: 'SENT',
      serviceLevel: 'STANDARD',
      sentAt: SENT_AT,
    });
  });

  it('a sent message is in the SENT state', () => {
    const sut = send();
    expect(sut.toPrimitives()).toMatchObject({ status: 'SENT' });
  });

  it('the recipient is stored in its normalised form', () => {
    const sut = send(Identity.new(), '+989121234567');
    expect(sut.toPrimitives()).toMatchObject({ recipient: '09121234567' });
  });

  it('sending records an SmsSent event naming the message, sender and recipient', () => {
    const senderId = Identity.new();
    const sut = send(senderId);
    expect(sut.releaseEvents()).toEqual([
      new SmsSent(
        sut.id.asString(),
        senderId.asString(),
        '09121234567',
        SENT_AT,
      ),
    ]);
  });

  it('the time of sending is the one supplied, not the machine clock', () => {
    const sut = send();
    expect(sut.toPrimitives()).toMatchObject({ sentAt: SENT_AT });
  });

  it('a message records the service level it was sent at', () => {
    expect(sendExpress().toPrimitives()).toMatchObject({
      serviceLevel: 'EXPRESS',
    });
  });

  it('an express message is guaranteed to reach the operator five minutes after sending', () => {
    expect(sendExpress().guaranteedDeliveryAt()).toEqual(
      new Date('2026-01-01T00:05:00.000Z'),
    );
  });

  it('a standard message carries no delivery guarantee', () => {
    expect(send().guaranteedDeliveryAt()).toBeUndefined();
  });
});
