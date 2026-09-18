import { IsEnum, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MfaMethod } from '@alumini/types';

export class MfaSetupQueryDto {
  @ApiPropertyOptional({ enum: MfaMethod, default: MfaMethod.TOTP })
  @IsOptional()
  @IsEnum(MfaMethod)
  method?: MfaMethod = MfaMethod.TOTP;

  @ApiPropertyOptional({
    description: 'Required when method=sms. E.164 format (e.g. +919876543210)',
  })
  @IsOptional()
  // E.164 validated with a plain regex rather than @IsPhoneNumber() —
  // that decorator needs libphonenumber-js, which isn't a project dependency.
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Phone must be in E.164 format, e.g. +919876543210',
  })
  phone?: string;
}
