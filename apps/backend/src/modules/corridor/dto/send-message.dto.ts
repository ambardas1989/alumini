import { IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@alumini/types';

/**
 * messageType is restricted to 'text' | 'attachment' | 'announcement' —
 * 'system' and 'event_card' are never client-settable. Those two are only
 * ever created internally by CorridorService's event listeners
 * (classroom.created, verification.approved, event.created); letting a
 * client set message_type to 'system' would let them forge an
 * official-looking announcement. 'announcement' itself needs no extra
 * DTO-level gate beyond the existing verified-member requirement every
 * post already goes through (MembershipService.canAccessChannel()) — see
 * TASKS_09 TASK 24.
 */
export class SendMessageDto {
  @ApiProperty({ description: 'Message text' })
  @IsString()
  @Length(1, 10_000)
  content: string;

  @ApiPropertyOptional({
    enum: [MessageType.TEXT, MessageType.ATTACHMENT, MessageType.ANNOUNCEMENT],
    default: MessageType.TEXT,
  })
  @IsOptional()
  @IsIn([MessageType.TEXT, MessageType.ATTACHMENT, MessageType.ANNOUNCEMENT])
  messageType?: MessageType;

  @ApiPropertyOptional({ description: 'e.g. attachment storage path, for message_type=attachment' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
