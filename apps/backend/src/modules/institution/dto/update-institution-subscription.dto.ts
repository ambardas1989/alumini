import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** TASKS_11 TASK 04 — platform admin only. */
export class UpdateInstitutionSubscriptionDto {
  @ApiPropertyOptional({ enum: ['free', 'tier3'] })
  @IsOptional()
  @IsIn(['free', 'tier3'])
  plan?: 'free' | 'tier3';

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'trial', 'cancelled'] })
  @IsOptional()
  @IsIn(['active', 'inactive', 'trial', 'cancelled'])
  status?: 'active' | 'inactive' | 'trial' | 'cancelled';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  trialEndsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxClassrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxMembersPerClassroom?: number;
}
