import { IsEmail, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiateEmailVerificationDto {
  @ApiProperty({ description: 'The classroom to verify membership in' })
  @IsUUID()
  classroomId: string;

  @ApiProperty({ description: "Secondary institutional email — doesn't change the login email" })
  @IsEmail()
  institutionalEmail: string;
}
