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
    description: 'Message sent and charged',
    schema: {
      properties: {
        id: {
          type: 'string',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        cost: { type: 'number', example: 1000 },
      },
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
  ): Promise<{ id: string; cost: number }> {
    // The value objects are built from DTO input that the validation pipe has
    // already checked against the same rules (see SendSmsDto), so the plain
    // `Error` they throw on invalid input is unreachable from here.
    return this.commandBus.execute(
      new SendSmsCommand(
        user.id,
        PhoneNumber.fromString(body.recipient),
        MessageBody.fromString(body.message),
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
