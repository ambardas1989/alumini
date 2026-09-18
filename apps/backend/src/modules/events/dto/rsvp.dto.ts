import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RsvpStatus } from '@alumini/types';

export class RsvpDto {
  @ApiProperty({ enum: RsvpStatus })
  @IsEnum(RsvpStatus)
  status: RsvpStatus;
}
