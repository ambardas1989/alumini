import { ApiProperty } from '@nestjs/swagger';

export class LoginResponseUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  activePersona: string;
}

/**
 * Response shape for POST /auth/mfa/verify and the login-completing branch
 * of POST /auth/mfa/challenge — see auth.service.ts completeMfaSetup() and
 * challengeMfa(). Both now return this exact shape (previously challengeMfa()
 * returned the differently-shaped TokenPairResponse — accessToken/
 * refreshToken/expiresIn/AuthUserSummary — while the frontend had always
 * been typed (and stored data) as if it were this shape; `expiresAt` being
 * silently `undefined` at runtime, plus refreshToken never being present
 * on EITHER path, meant the client could never tell when its 15-minute
 * access token was about to die or silently refresh it — the real cause
 * of the "session expired" banner appearing during any normal session
 * (TASKS_03.md TASK 02)).
 */
export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Exchanged at POST /auth/refresh for a new access/refresh pair before the access token expires' })
  refreshToken: string;

  @ApiProperty({ description: 'ISO timestamp — when accessToken itself expires (JWT_ACCESS_EXPIRY_MINUTES from issuance), NOT the refresh token' })
  expiresAt: string;

  @ApiProperty({ type: LoginResponseUserDto })
  user: LoginResponseUserDto;
}
