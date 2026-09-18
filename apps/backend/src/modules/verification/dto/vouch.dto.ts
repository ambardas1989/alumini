import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VouchDto {
  @ApiProperty()
  @IsUUID()
  classroomId: string;

  @ApiProperty({ description: 'User id of the person being vouched for' })
  @IsUUID()
  voucheeId: string;
}
