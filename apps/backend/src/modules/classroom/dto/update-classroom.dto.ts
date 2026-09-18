import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Deliberately narrow — only the fields SPEC.md §7 describes as classroom-
 * admin-editable settings. Structural fields (institution, batch year,
 * grade/section/program, the global ID itself) are immutable after
 * creation; changing them would silently invalidate the global ID's own
 * uniqueness guarantee.
 */
export class UpdateClassroomDto {
  @ApiPropertyOptional({ description: 'Human-readable classroom name' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ description: 'Enable/disable the Staff Room channel' })
  @IsOptional()
  @IsBoolean()
  hasStaffRoom?: boolean;

  @ApiPropertyOptional({ description: 'Enable/disable the Student Alley channel' })
  @IsOptional()
  @IsBoolean()
  hasStudentAlley?: boolean;

  @ApiPropertyOptional({ description: 'Require verification before members can post' })
  @IsOptional()
  @IsBoolean()
  requireVerification?: boolean;
}
