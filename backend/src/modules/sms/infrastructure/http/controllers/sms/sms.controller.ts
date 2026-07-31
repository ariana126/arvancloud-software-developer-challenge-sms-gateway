import {
  AuthenticatedUser,
  CurrentUser,
  domainErrorSchema,
  JwtAuthGuard,
  JwtUnauthorizedSchema,
  ValidationErrorSchema,
} from '@framework/infrastructure';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SendSmsCommand } from '@sms/application/commands/send-sms/send-sms.command';
import { GetSenderTrafficQuery } from '@sms/application/queries/get-sender-traffic/get-sender-traffic.query';
import { SenderTrafficReadModel } from '@sms/application/queries/get-sender-traffic/sender-traffic.read-model';
import { GetSentSmsReportQuery } from '@sms/application/queries/get-sent-sms-report/get-sent-sms-report.query';
import { SentSmsReadModel } from '@sms/application/queries/get-sent-sms-report/sent-sms.read-model';
import { GetSmsPricingQuery } from '@sms/application/queries/get-sms-pricing/get-sms-pricing.query';
import { SmsPricingReadModel } from '@sms/application/queries/get-sms-pricing/sms-pricing.read-model';
import { MessageBody } from '@sms/domain/value/message-body';
import { PhoneNumber } from '@sms/domain/value/phone-number';
import { ServiceLevel } from '@sms/domain/value/service-level';

import { SendSmsDto } from './dto/send-sms.dto';

const InsufficientCreditSchema = domainErrorSchema(
  'insufficient-credit',
  'Insufficient Credit',
  402,
  'Sending an SMS costs 1000, but the sender has only 400.',
  {
    required: { type: 'number', example: 1000 },
    available: { type: 'number', example: 400 },
  },
);

@ApiTags('SMS')
@Controller('sms')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SmsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Send an SMS, charged against the current credit' })
  @ApiCreatedResponse({
    description:
      'Message sent and charged. `guaranteedDeliveryAt` is present only for an express send — a standard send promises no delivery time, so the field is absent rather than null.',
    schema: {
      properties: {
        id: {
          type: 'string',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        cost: { type: 'number', example: 1000 },
        guaranteedDeliveryAt: {
          type: 'string',
          format: 'date-time',
          description:
            'The instant by which an express message is guaranteed to reach the operator. Omitted for a standard send.',
          example: '2026-01-01T00:05:00.000Z',
        },
      },
      required: ['id', 'cost'],
    },
  })
  @ApiBadRequestResponse({ schema: ValidationErrorSchema })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid JWT token',
    schema: JwtUnauthorizedSchema,
  })
  @ApiResponse({
    status: 402,
    description: 'The balance does not cover one message; nothing is charged',
    schema: InsufficientCreditSchema,
  })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SendSmsDto,
  ): Promise<{ id: string; cost: number; guaranteedDeliveryAt?: string }> {
    // The value objects are built from DTO input that the validation pipe has
    // already checked against the same rules (see SendSmsDto), so the plain
    // `Error` they throw on invalid input is unreachable from here.
    //
    // An omitted service level means standard. That default lives here because
    // this is the only layer that can tell "the request said nothing" from "the
    // request said STANDARD" — to the domain those are the same send.
    return this.commandBus.execute(
      new SendSmsCommand(
        user.id,
        PhoneNumber.fromString(body.recipient),
        MessageBody.fromString(body.message),
        body.serviceLevel
          ? ServiceLevel.fromString(body.serviceLevel)
          : ServiceLevel.standard(),
      ),
    );
  }

  @Get('pricing')
  @ApiOperation({ summary: 'Get the price of sending one SMS' })
  @ApiOkResponse({
    schema: {
      properties: {
        costPerSms: { type: 'number', example: 1000 },
        currency: { type: 'string', example: 'RIALS' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid JWT token',
    schema: JwtUnauthorizedSchema,
  })
  async pricing(): Promise<SmsPricingReadModel> {
    return this.queryBus.execute(new GetSmsPricingQuery());
  }

  @Get('traffic')
  @ApiOperation({
    summary: "Get how the current user's send rate is currently classified",
  })
  @ApiOkResponse({
    description:
      "Traffic is carried on isolated paths so that one customer's volume cannot delay another's. This reports which classification the caller falls into and the numbers behind it. A customer that has sent nothing recently reads as SHARED with a count of zero — a new customer and a quiet one are the same customer here.",
    schema: {
      properties: {
        tier: {
          type: 'string',
          enum: ['SHARED', 'BULK'],
          description:
            'SHARED is the long tail; BULK is a high-volume sender, handled apart from it. BULK is not a lower priority — it is separate capacity.',
          example: 'SHARED',
        },
        sendsInWindow: {
          type: 'number',
          description: 'Messages sent inside the window currently open.',
          example: 12,
        },
        windowInSeconds: {
          type: 'number',
          description: 'How far back `sendsInWindow` reaches.',
          example: 60,
        },
        bulkThreshold: {
          type: 'number',
          description:
            'The count above which a sender is classified BULK, published so a customer can see it coming.',
          example: 1000,
        },
      },
      required: ['tier', 'sendsInWindow', 'windowInSeconds', 'bulkThreshold'],
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid JWT token',
    schema: JwtUnauthorizedSchema,
  })
  async traffic(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SenderTrafficReadModel> {
    return this.queryBus.execute(new GetSenderTrafficQuery(user.id));
  }

  @Get()
  @ApiOperation({ summary: "Get a report of the current user's sent messages" })
  @ApiOkResponse({
    description:
      'The messages this user has sent, newest first. A user who has sent nothing gets an empty array — an empty report is a report, not a missing one, so there is no 404 on this route.',
    schema: {
      type: 'array',
      items: {
        properties: {
          id: {
            type: 'string',
            example: '550e8400-e29b-41d4-a716-446655440000',
          },
          recipient: { type: 'string', example: '09121234567' },
          message: {
            type: 'string',
            description:
              'The text that was sent, under the same name it was sent with.',
            example: 'Your order has shipped.',
          },
          status: { type: 'string', example: 'SENT' },
          serviceLevel: {
            type: 'string',
            enum: ['STANDARD', 'EXPRESS'],
            example: 'STANDARD',
          },
          cost: {
            type: 'number',
            description:
              'What one message costs at the current tariff. Bare, like the send response — `GET /api/sms/pricing` is where the currency is published.',
            example: 1000,
          },
          sentAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-01-01T00:00:00.000Z',
          },
        },
        required: [
          'id',
          'recipient',
          'message',
          'status',
          'serviceLevel',
          'cost',
          'sentAt',
        ],
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid JWT token',
    schema: JwtUnauthorizedSchema,
  })
  async report(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SentSmsReadModel[]> {
    // The authenticated user is the only input, so there is no request-supplied
    // identifier that could name somebody else's report and nothing here to
    // authorize beyond the guard above.
    return this.queryBus.execute(new GetSentSmsReportQuery(user.id));
  }
}
