import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaRecoveryRequestDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}
