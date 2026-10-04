import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const INSTITUTION_ADMIN_REQUEST_ROLES = ['principal', 'vice_principal', 'admin_staff', 'teacher'] as const;
export type InstitutionAdminRequestRole = (typeof INSTITUTION_ADMIN_REQUEST_ROLES)[number];

/** TASKS_11 TASK 01 — "request institution admin access" form, reusing InstitutionService's existing claim/co-admin-request machinery (see 031_institution_admin_requests.sql's own comment for why this isn't a new table). */
export class RequestAdminAccessDto {
  @ApiProperty({ description: 'Institution to request admin access for' })
  @IsUUID()
  institutionId: string;

  @ApiProperty({ description: "Requester's full name, for the platform-admin review queue" })
  @IsString()
  @Length(1, 200)
  fullName: string;

  @ApiProperty({ enum: INSTITUTION_ADMIN_REQUEST_ROLES, description: "Requester's role at the institution" })
  @IsIn(INSTITUTION_ADMIN_REQUEST_ROLES)
  role: InstitutionAdminRequestRole;

  @ApiPropertyOptional({ description: 'Optional note for the platform-admin review queue', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  message?: string;
}
