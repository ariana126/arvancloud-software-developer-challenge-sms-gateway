import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive } from 'class-validator';

export class IncreaseCreditDto {
  @IsInt()
  @IsPositive()
  @ApiProperty({ example: 50_000, description: 'Amount to add, in Rials.' })
  amount: number;
}
