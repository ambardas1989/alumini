import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoveAdminDto {
  @ApiProperty({ description: 'Reason for removal — stored in the audit trail' })
  @IsString()
  @Length(1, 500)
  reason: string;
}
