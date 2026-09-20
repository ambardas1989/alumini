import { IsIn, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const INSTITUTION_TYPES = ['school', 'college', 'university'] as const;
const REQUESTER_RELATIONSHIPS = ['alumni', 'teacher', 'admin', 'other'] as const;

export class RequestInstitutionDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  name: string;

  @ApiProperty({ enum: INSTITUTION_TYPES })
  @IsIn(INSTITUTION_TYPES)
  type: (typeof INSTITUTION_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 10)
  cityCode?: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 country code' })
  @IsString()
  @Length(2, 2)
  countryCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 255)
  emailDomain?: string;

  @ApiProperty({ enum: REQUESTER_RELATIONSHIPS })
  @IsIn(REQUESTER_RELATIONSHIPS)
  requesterRelationship: (typeof REQUESTER_RELATIONSHIPS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}
