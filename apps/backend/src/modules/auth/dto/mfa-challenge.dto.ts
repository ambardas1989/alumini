import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MfaMethod } from '@alumini/types';

/**
 * Verifies an MFA code for an already-enrolled account — either to complete
 * a login (mfa_login pending token) or to re-authorise a sensitive action
 * (a normal access token). See AuthTokenPayload['purpose'] for the split.
 */
export class MfaChallengeDto {
  @ApiPropertyOptional({
    enum: MfaMethod,
    description: 'Defaults to the method already on file for this account',
  })
  @IsOptional()
  @IsEnum(MfaMethod)
  method?: MfaMethod;

  @ApiProperty({ description: '6-digit code from the authenticator app or SMS' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiPropertyOptional({
    description:
      'Non-consuming check — verifies the code without marking an email OTP as used, so the same code can be ' +
      'submitted again for the real action afterward. Ignored (always treated as false) when completing a login.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  peek?: boolean;
}
