import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** TASKS_11 TASK 07 — delegates to ClassroomService.createClassroom() (see InstitutionService.createClassroomForInstitution()) with creatorRole forced to 'admin', so institutionId isn't repeated in the body (it's the route param). */
export class CreateClassroomForInstitutionDto {
  @ApiProperty()
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty()
  @IsInt()
  @Min(1900)
  @Max(2100)
  batchYear: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 2)
  grade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 5)
  section?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 20)
  program?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  hasTeacherRoom?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requireVerification?: boolean;
}
