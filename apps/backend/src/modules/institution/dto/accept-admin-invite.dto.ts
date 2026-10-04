import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** TASKS_11 TASK 01 — authenticated POST accept-invite, body carries the magic-link token (distinct from InstitutionController's existing public GET ?token= route — see institution-admin.controller.ts's own comment). */
export class AcceptAdminInviteDto {
  @ApiProperty({ description: 'The magic-link invite token from the email' })
  @IsString()
  @Length(1, 2000)
  token: string;
}
