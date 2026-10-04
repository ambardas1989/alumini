import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** TASKS_11 TASK 07 — institution admin editing any classroom in their institution (vs. ClassroomService.updateClassroom(), which deliberately requires being THAT classroom's own admin — see its own doc comment). */
export class UpdateClassroomForInstitutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasTeacherRoom?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireVerification?: boolean;
}
