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

/** Response shape for POST /auth/mfa/verify — see auth.service.ts completeMfaSetup(). */
export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'ISO timestamp — when the session (refresh token) expires' })
  expiresAt: string;

  @ApiProperty({ type: LoginResponseUserDto })
  user: LoginResponseUserDto;
}
