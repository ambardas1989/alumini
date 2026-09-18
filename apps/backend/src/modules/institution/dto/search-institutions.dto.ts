import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Moved here from ClassroomService, which originally had this as a plain
 * method-parameter search with a comment saying "min 2 chars enforced in
 * controller" — a controller that was never built. Enforced for real now.
 */
export class SearchInstitutionsDto {
  @ApiProperty({ description: 'Partial institution name, minimum 2 characters' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code to narrow results' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;
}
