import { IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * ASSUMPTION: accepts a public Storage URL in a JSON body rather than a
 * multipart file upload — this backend has no multer/file-upload
 * middleware configured anywhere (see codes/dto/import-csv.dto.ts's own
 * identical note), and the profile-avatar-upload feature already
 * established the pattern this follows: the frontend uploads the image
 * directly to Supabase Storage (a public bucket, same as 'profile-avatars')
 * and hands this endpoint just the resulting public URL to persist.
 */
export class UpdateLogoDto {
  @ApiProperty({ description: 'Public Storage URL of the uploaded logo image' })
  @IsUrl()
  logoUrl: string;
}
