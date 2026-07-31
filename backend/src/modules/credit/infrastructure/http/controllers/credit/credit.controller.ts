import { IncreaseCreditCommand } from '@credit/application/commands/increase-credit/increase-credit.command';
import { GetWalletBalanceQuery } from '@credit/application/queries/get-wallet-balance/get-wallet-balance.query';
import { WalletBalanceReadModel } from '@credit/application/queries/get-wallet-balance/wallet-balance.read-model';
import { Money } from '@credit/domain/value/money';
import {
  AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  JwtUnauthorizedSchema,
  ValidationErrorSchema,
} from '@framework/infrastructure';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { IncreaseCreditDto } from './dto/increase-credit.dto';

@ApiTags('Credit')
@Controller('credit')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CreditController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('increase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Increase the current user's account credit" })
  @ApiNoContentResponse({ description: 'Credit increased successfully' })
  @ApiBadRequestResponse({ schema: ValidationErrorSchema })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid JWT token',
    schema: JwtUnauthorizedSchema,
  })
  async increase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: IncreaseCreditDto,
  ): Promise<void> {
    await this.commandBus.execute(
      new IncreaseCreditCommand(user.id, Money.rials(body.amount)),
    );
  }

  @Get()
  @ApiOperation({ summary: "Get the current user's account credit" })
  @ApiOkResponse({
    schema: { properties: { amount: { type: 'number', example: 50_000 } } },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid JWT token',
    schema: JwtUnauthorizedSchema,
  })
  async balance(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletBalanceReadModel> {
    return this.queryBus.execute(new GetWalletBalanceQuery(user.id));
  }
}
