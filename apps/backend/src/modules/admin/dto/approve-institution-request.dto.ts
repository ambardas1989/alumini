import { IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveInstitutionRequestDto {
  @ApiProperty({ description: 'Must be unique in institutions.slug' })
  @IsString()
  @Length(1, 50)
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 10)
  cityCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 255)
  emailDomain?: string;
}
