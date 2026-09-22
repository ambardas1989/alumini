import { IsOptional, IsString, Length, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ description: 'Required for an MFA-enabled account — email OTP or TOTP code' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  mfaCode?: string;
}
