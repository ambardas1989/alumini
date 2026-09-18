import { IsEnum, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MfaMethod } from '@alumini/types';

/** Confirms MFA enrolment — the method being set up must be stated explicitly. */
export class MfaVerifyDto {
  @ApiProperty({ enum: MfaMethod })
  @IsEnum(MfaMethod)
  method: MfaMethod;

  @ApiProperty({ description: '6-digit code from the authenticator app or SMS' })
  @IsString()
  @Length(6, 6)
  code: string;
}
