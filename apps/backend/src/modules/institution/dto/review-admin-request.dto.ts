import { IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** TASKS_11 TASK 01 — platform-admin approve/reject of a pending school_admin request. */
export class ReviewAdminRequestDto {
  @ApiPropertyOptional({ description: 'Optional review note', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}
