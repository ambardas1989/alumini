import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * POST /auth/change-password — an already-logged-in user setting a new
 * password. MFA re-challenge is enforced by MfaChallengeGuard at the
 * controller (X-MFA-Code header), not by a field on this DTO — same
 * pairing as every other MfaChallengeGuard-protected route.
 */
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;
}
