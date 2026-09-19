import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaRecoveryVerifyDto {
  @ApiProperty()
  @IsString()
  token: string;
}
