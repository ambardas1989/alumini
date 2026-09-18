import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkedinVerifyDto {
  @ApiProperty()
  @IsUUID()
  classroomId: string;
}
