import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaResetDevDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}
