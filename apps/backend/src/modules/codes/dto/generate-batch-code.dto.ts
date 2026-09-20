import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const EXPIRY_DAY_OPTIONS = [7, 30, 90] as const;

export class GenerateBatchCodeDto {
  @ApiProperty()
  @IsUUID()
  institutionId: string;

  @ApiProperty({ description: 'Classroom this code grants access to' })
  @IsUUID()
  classroomId: string;

  @ApiProperty({ description: 'Maximum number of redemptions — capped at appConfig.MAX_BATCH_CODE_REDEMPTIONS' })
  @IsInt()
  @Min(1)
  maxRedemptions: number;

  @ApiPropertyOptional({ enum: EXPIRY_DAY_OPTIONS, description: 'Defaults to appConfig.CODE_EXPIRY_DAYS when omitted' })
  @IsOptional()
  @IsIn(EXPIRY_DAY_OPTIONS)
  expiresInDays?: (typeof EXPIRY_DAY_OPTIONS)[number];
}
