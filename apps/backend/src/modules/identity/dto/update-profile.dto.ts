import { IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Only fields the owner may edit directly. Deliberately excludes:
 * - email          — the Supabase Auth identity; changing it needs GoTrue's
 *                     own change-email flow, out of scope for this module.
 * - mfa_enabled/mfa_method — owned by the auth module.
 * - active_persona — owned by POST /identity/personas/switch, so every
 *                     switch goes through the one code path that audits it.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Full name shown across the app' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Public URL of the profile photo' })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'E.164 format, e.g. +919876543210' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Phone must be in E.164 format, e.g. +919876543210',
  })
  phone?: string;

  @ApiPropertyOptional({ description: 'Public LinkedIn profile URL' })
  @IsOptional()
  @IsUrl()
  linkedinUrl?: string;
}
