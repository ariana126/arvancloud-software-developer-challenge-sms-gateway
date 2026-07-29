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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SendSmsCommand } from '@sms/application/commands/send-sms/send-sms.command';
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
  @ApiConflictResponse({
    schema: domainErrorSchema(
      'concurrent-modification',
      'Concurrent Modification',
      409,
      'Could not update the wallet: too many concurrent modifications.',
    ),
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
}
