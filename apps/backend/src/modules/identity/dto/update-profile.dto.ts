import { IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * TASKS_07 TASK 09 FIX D — best-effort auto-correction before E.164
 * validation runs, so a user typing a locally-formatted number doesn't
 * get rejected for something this can trivially fix itself:
 *   "9876543210"        → "+919876543210" (bare 10 digits, India default)
 *   "09876543210"        → "+919876543210" (leading 0, 10 digits after it)
 *   "919876543210"       → "+919876543210" (digits only, no leading 0)
 *   "+91 98765 43210"    → "+919876543210" (spaces/hyphens/parens stripped)
 * Anything already starting with '+', or that doesn't match one of these
 * shapes, is passed through unchanged for @Matches below to accept or
 * reject on its own — this never tries to guess a country for a number
 * that doesn't look like a bare local one.
 */
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const stripped = value.replace(/[\s\-()]/g, '');
  if (!stripped || stripped.startsWith('+')) return stripped;

  if (/^0\d{10}$/.test(stripped)) return `+91${stripped.slice(1)}`;
  if (/^\d{10}$/.test(stripped)) return `+91${stripped}`;
  if (/^\d+$/.test(stripped)) return `+${stripped}`;

  return stripped;
}

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

  @ApiPropertyOptional({ description: 'E.164 format, e.g. +919876543210 — best-effort auto-corrected if not (see normalizePhone() above)' })
  @IsOptional()
  @Transform(({ value }) => normalizePhone(value))
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Phone must be in E.164 format, e.g. +919876543210',
  })
  phone?: string;

  @ApiPropertyOptional({ description: 'Public LinkedIn profile URL' })
  @IsOptional()
  @IsUrl()
  linkedinUrl?: string;
}
