import { IsDateString, IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@alumini/types';

/**
 * messageType is restricted to 'text' | 'attachment' | 'announcement' |
 * 'visiting_city' — 'system' and 'event_card' are never client-settable.
 * Those two are only ever created internally by CorridorService's event
 * listeners (classroom.created, verification.approved, event.created);
 * letting a client set message_type to 'system' would let them forge an
 * official-looking announcement. 'announcement'/'visiting_city' need no
 * extra DTO-level gate beyond the existing verified-member requirement
 * every post already goes through (MembershipService.canAccessChannel())
 * — see TASKS_09 TASK 24/25.
 */
export class SendMessageDto {
  @ApiProperty({ description: 'Message text — for message_type=visiting_city, this is the human-readable fallback (e.g. "Visiting Mumbai · Dec 21 - Dec 23"), not the structured data' })
  @IsString()
  @Length(1, 10_000)
  content: string;

  @ApiPropertyOptional({
    enum: [MessageType.TEXT, MessageType.ATTACHMENT, MessageType.ANNOUNCEMENT, MessageType.VISITING_CITY],
    default: MessageType.TEXT,
  })
  @IsOptional()
  @IsIn([MessageType.TEXT, MessageType.ATTACHMENT, MessageType.ANNOUNCEMENT, MessageType.VISITING_CITY])
  messageType?: MessageType;

  @ApiPropertyOptional({ description: 'e.g. attachment storage path, for message_type=attachment' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  // TASKS_09 TASK 25 — required together for message_type=visiting_city;
  // cross-field validation (all three present, from <= to, from not more
  // than 30 days in the past) happens in CorridorService.sendMessage()
  // rather than here, matching this codebase's established pattern of
  // doing cross-field/business-rule checks in the service layer (see
  // CreateEventDto's own "must be in the future" comment).
  @ApiPropertyOptional({ description: 'City name — required for message_type=visiting_city' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  @ApiPropertyOptional({ description: 'ISO date string — required for message_type=visiting_city' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'ISO date string — required for message_type=visiting_city' })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}
