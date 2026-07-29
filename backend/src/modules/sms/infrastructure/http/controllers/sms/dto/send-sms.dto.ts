import { ApiProperty } from '@nestjs/swagger';
import { MessageBody } from '@sms/domain/value/message-body';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Every constraint here **mirrors a value object**, and nothing enforces the
 * pairing — no test, no type, no lint rule. The mirroring is what makes a bad
 * request a 400 from the validation pipe instead of a 500: `PhoneNumber` and
 * `MessageBody` follow the house style and throw a plain `Error`, which no
 * `ExceptionMapper` matches, so it falls through to
 * `ProblemDetail.forUnknownError()`. If a rule below drifts from its value
 * object, the gap does not fail a build — it just turns into a 500.
 *
 * The pairing, in both directions:
 *
 * | This DTO                          | Mirrors                                |
 * |-----------------------------------|----------------------------------------|
 * | `recipient` `@Matches(MOBILE)`    | `PhoneNumber.LOCAL` / `.INTERNATIONAL` |
 * | `message`   `@IsNotEmpty`         | `MessageBody` rejects an empty body    |
 * | `message`   `@MaxLength(160)`     | `MessageBody.MAX_LENGTH`               |
 *
 * Change either side and change the other.
 */
export class SendSmsDto {
  /**
   * Mirrors `PhoneNumber.LOCAL` and `PhoneNumber.INTERNATIONAL` — an Iranian
   * mobile number in local (`09121234567`) or international (`+989121234567`)
   * form. Change `phone-number.ts` and this regex changes with it.
   */
  @ApiProperty({ example: '09121234567' })
  @IsString()
  @Matches(/^(?:09\d{9}|\+989\d{9})$/, {
    message: 'recipient must be a valid Iranian mobile number',
  })
  recipient: string;

  /**
   * Mirrors `MessageBody`: non-empty, and at most `MessageBody.MAX_LENGTH`
   * (160 — one GSM segment). Change `message-body.ts` and these change with it.
   */
  @ApiProperty({ example: 'Your order has shipped.', maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MessageBody.MAX_LENGTH)
  message: string;
}
