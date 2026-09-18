import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MemberRole } from '@alumini/types';

export class ChangeRoleDto {
  @ApiProperty({ description: 'User id of the member whose role is changing' })
  @IsUUID()
  targetUserId: string;

  @ApiProperty({ enum: MemberRole, description: 'The role to assign' })
  @IsEnum(MemberRole)
  role: MemberRole;
}
