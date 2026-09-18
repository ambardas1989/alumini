import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteAdminDto {
  @ApiProperty({ description: 'Email address to send the magic-link invitation to' })
  @IsEmail()
  email: string;
}
