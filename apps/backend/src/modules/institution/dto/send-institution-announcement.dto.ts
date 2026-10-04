import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendInstitutionAnnouncementDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @Length(1, 100)
  title: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @Length(1, 1000)
  body: string;

  @ApiProperty({ enum: ['all', 'specific'] })
  @IsIn(['all', 'specific'])
  target: 'all' | 'specific';

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((dto) => dto.target === 'specific')
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  targetClassroomIds?: string[];
}
