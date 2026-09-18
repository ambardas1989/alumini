import { IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmEmailOtpDto {
  @ApiProperty()
  @IsUUID()
  classroomId: string;

  @ApiProperty({ description: 'The 6-digit code sent to the institutional email' })
  @IsString()
  @Length(6, 6)
  otp: string;
}
