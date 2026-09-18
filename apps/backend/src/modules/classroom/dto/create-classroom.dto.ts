import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  IsUUID,
  Min,
  Max,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClassroomDto {
  @ApiProperty({ description: 'Institution UUID from institutions table' })
  @IsUUID()
  institutionId: string;

  @ApiProperty({ description: 'Human-readable classroom name' })
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ description: 'Year students passed out of this class' })
  @IsInt()
  @Min(1900)
  @Max(2100)
  batchYear: number;

  @ApiPropertyOptional({ description: 'Grade number for schools (e.g. "9", "10", "12")' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,2}$/, { message: 'Grade must be a number (e.g. "9", "12")' })
  grade?: string;

  @ApiPropertyOptional({ description: 'Section letter for schools (e.g. "A", "B")' })
  @IsOptional()
  @IsString()
  @Length(1, 5)
  section?: string;

  @ApiPropertyOptional({ description: 'Program slug for colleges (e.g. "MBA", "BTECH")' })
  @IsOptional()
  @IsString()
  @Length(2, 20)
  program?: string;

  @ApiPropertyOptional({ default: true, description: 'Enable Staff Room channel' })
  @IsOptional()
  @IsBoolean()
  hasStaffRoom?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Enable Student Alley channel' })
  @IsOptional()
  @IsBoolean()
  hasStudentAlley?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Require verification to post' })
  @IsOptional()
  @IsBoolean()
  requireVerification?: boolean;
}
