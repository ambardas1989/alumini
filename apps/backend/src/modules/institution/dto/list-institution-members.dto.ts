import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListInstitutionMembersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @ApiPropertyOptional({ enum: ['student', 'teacher', 'admin'] })
  @IsOptional()
  @IsIn(['student', 'teacher', 'admin'])
  role?: 'student' | 'teacher' | 'admin';

  @ApiPropertyOptional({ enum: ['pending', 'pending_auto', 'verified', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'pending_auto', 'verified', 'rejected'])
  verificationStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
