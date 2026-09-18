import { IsEnum, IsUUID, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PersonaType } from '@alumini/types';

/**
 * institutionId is required for teacher/school_admin (they're scoped to one
 * institution each) and must be omitted for alumni (institution_id is NULL
 * on that row — see the personas_alumni_unique_idx partial unique index in
 * 001_initial_schema.sql, which enforces at most one alumni persona per user).
 * The "must be omitted for alumni" half of that rule is enforced in
 * IdentityService, not here — @ValidateIf only covers the "required when
 * not alumni" half.
 */
export class AddPersonaDto {
  @ApiProperty({ enum: PersonaType })
  @IsEnum(PersonaType)
  type: PersonaType;

  @ApiPropertyOptional({ description: 'Required for teacher/school_admin, omitted for alumni' })
  @ValidateIf((dto: AddPersonaDto) => dto.type !== PersonaType.ALUMNI)
  @IsUUID()
  institutionId?: string;
}
