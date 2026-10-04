import { IsIn, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** TASKS_11 TASK 05 — institution admin promoting/demoting a classroom-level role, across any classroom in their institution (vs. MembershipService.changeRole(), which only lets a classroom's OWN admin change roles within that one classroom). */
export class SetClassroomAdminRoleDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty()
  @IsUUID()
  classroomId: string;

  @ApiProperty({ enum: ['promote', 'demote'] })
  @IsIn(['promote', 'demote'])
  action: 'promote' | 'demote';
}
