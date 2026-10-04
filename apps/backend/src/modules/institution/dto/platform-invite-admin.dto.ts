import { IsEmail, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** TASKS_11 TASK 01 — platform admin directly inviting someone as an institution's admin (vs. InviteAdminDto's existing primary-admin-inviting-a-co-admin case, reused by the same service method). */
export class PlatformInviteAdminDto {
  @ApiProperty({ description: 'Institution the invitee will administer' })
  @IsUUID()
  institutionId: string;

  @ApiProperty({ description: 'Email address to send the magic-link invitation to' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'Invite link lifetime in days (default 7)', minimum: 1, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
