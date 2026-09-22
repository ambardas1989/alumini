import { IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Same "Storage URL, not the file itself" reasoning as institution/dto/update-logo.dto.ts. */
export class UpdateCoverDto {
  @ApiProperty({ description: 'Public Storage URL of the uploaded cover image' })
  @IsUrl()
  coverUrl: string;
}
