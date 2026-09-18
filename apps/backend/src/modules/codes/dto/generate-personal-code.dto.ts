import { IsEmail, IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GeneratePersonalCodeDto {
  @ApiProperty()
  @IsUUID()
  institutionId: string;

  @ApiProperty({ description: 'Classroom this code grants access to' })
  @IsUUID()
  classroomId: string;

  @ApiProperty({ description: 'Name the code is tied to (not used for auth, display only)' })
  @IsString()
  @Length(1, 200)
  boundName: string;

  @ApiProperty({ description: 'Email the code is sent to' })
  @IsEmail()
  boundEmail: string;
}
