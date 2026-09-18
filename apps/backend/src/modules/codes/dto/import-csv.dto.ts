import { IsString, IsUUID, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * ASSUMPTION: accepts CSV content as a string field in a JSON body rather
 * than a multipart file upload — this backend has no multer/file-upload
 * middleware configured anywhere yet, and the task didn't mandate
 * multipart specifically ("accept CSV"). The frontend reads the selected
 * file as text client-side and sends its content here. Switching to a real
 * multipart upload later only touches the controller (add
 * @UseInterceptors(FileInterceptor(...)) and read file.buffer.toString()),
 * not CodesService's parsing/import logic.
 */
export class ImportCsvDto {
  @ApiProperty({ description: 'Institution these students belong to' })
  @IsUUID()
  institutionId: string;

  @ApiProperty({
    description:
      'Raw CSV content — header row first_name,last_name,email,class,section,batch_year,roll_number',
  })
  @IsString()
  @MinLength(1)
  csvContent: string;
}
