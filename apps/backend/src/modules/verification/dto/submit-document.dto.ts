import { IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitDocumentDto {
  @ApiProperty()
  @IsUUID()
  classroomId: string;

  @ApiProperty({
    description:
      'Path in the private verification-documents Supabase Storage bucket (never a public URL) — ' +
      'the client uploads directly to Storage first and passes the resulting path here',
  })
  @IsString()
  @Length(1, 500)
  storagePath: string;
}
