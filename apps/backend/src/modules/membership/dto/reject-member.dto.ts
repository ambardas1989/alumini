import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** TASKS_09 TASK 12 — same shape as verification module's RejectDocumentDto. */
export class RejectMemberDto {
  @ApiProperty({ description: 'Shown to the member — stored in the audit trail' })
  @IsString()
  @Length(1, 500)
  reason: string;
}
