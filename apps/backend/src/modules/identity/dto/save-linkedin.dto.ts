import { IsBoolean, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * TASKS_05 TASK 06 (scoped down — see auth.service.ts's connectLinkedin()
 * doc comment). LinkedIn's OAuth only ever hands back an id/name/photo, so
 * "confirmedFields" collapses to two booleans: did the user check the name
 * suggestion, did they check the photo suggestion. name/avatarUrl are the
 * values connectLinkedin() already returned to the frontend — sent back
 * here rather than re-fetched, since the access token from the OAuth
 * exchange isn't retained anywhere (this app never stores a LinkedIn
 * refresh token, another consequence of there being no sync feature).
 */
export class SaveLinkedinDto {
  @ApiProperty({ description: "LinkedIn's own id for this account (the OIDC 'sub' claim)" })
  @IsString()
  @MinLength(1)
  linkedinId: string;

  @ApiPropertyOptional({ description: 'Whether the user confirmed using their LinkedIn name' })
  @IsOptional()
  @IsBoolean()
  confirmName?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Whether the user confirmed using their LinkedIn photo' })
  @IsOptional()
  @IsBoolean()
  confirmAvatar?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
