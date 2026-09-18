import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RedeemCodeDto {
  @ApiProperty()
  @IsUUID()
  classroomId: string;

  @ApiProperty({ description: 'Format: {COUNTRY}-{YEAR}-{RANDOM6}, e.g. IN-2026-A7K2PQ' })
  @IsString()
  code: string;
}
