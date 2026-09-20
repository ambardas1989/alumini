import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendDmDto {
  @ApiProperty({ description: 'Message text' })
  @IsString()
  @Length(1, 2000)
  content: string;
}
