import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** TASKS_11 TASK 04 — no payment processing here, just a notification to platform admins (same scope limit PremiumService documents for per-user premium). */
export class RequestSubscriptionUpgradeDto {
  @ApiProperty({ enum: ['tier3'] })
  @IsIn(['tier3'])
  plan: 'tier3';

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  message?: string;
}
