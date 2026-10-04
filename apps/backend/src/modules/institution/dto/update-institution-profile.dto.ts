import { IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const INSTITUTION_BOARDS = ['CBSE', 'ICSE', 'State', 'IB', 'Other'] as const;
export const INSTITUTION_MEDIUMS = ['English', 'Hindi', 'Regional', 'Other'] as const;

/** TASKS_11 TASK 03 — institution admin's own settings page. type/slug/country are NOT editable here (search/global-id-sensitive, platform-admin territory). */
export class UpdateInstitutionProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(new Date().getFullYear())
  foundedYear?: number;

  @ApiPropertyOptional({ enum: INSTITUTION_BOARDS })
  @IsOptional()
  @IsIn(INSTITUTION_BOARDS)
  board?: string;

  @ApiPropertyOptional({ enum: INSTITUTION_MEDIUMS })
  @IsOptional()
  @IsIn(INSTITUTION_MEDIUMS)
  medium?: string;
}
