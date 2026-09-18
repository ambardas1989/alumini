import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferPrimaryAdminDto {
  @ApiProperty({ description: 'User id of the existing active admin to promote to primary' })
  @IsUUID()
  targetUserId: string;
}
