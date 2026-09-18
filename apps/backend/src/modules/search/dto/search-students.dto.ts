import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchStudentsDto {
  @ApiProperty({ description: 'Partial student name, minimum 2 characters' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({
    description:
      'Narrow the search to one classroom — must be one the caller is a verified teacher in. ' +
      'Omit to search across every classroom the caller is verified in.',
  })
  @IsOptional()
  @IsUUID()
  classroomId?: string;
}
