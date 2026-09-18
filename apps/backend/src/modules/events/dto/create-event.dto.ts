import { IsBoolean, IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * "event_date must be in the future" is enforced in EventsService, not
 * here — "future" is relative to request time, which a static class-
 * validator decorator can't express cleanly. Matches this codebase's
 * existing convention of doing request-time-relative checks in the
 * service layer (e.g. ClassroomService's grade/program presence check).
 */
export class CreateEventDto {
  @ApiProperty({ description: 'Event title' })
  @IsString()
  @Length(1, 200)
  title: string;

  @ApiProperty({ description: 'ISO 8601 date-time, must be in the future' })
  @IsISO8601()
  eventDate: string;

  @ApiPropertyOptional({ description: 'Free-text location, or omit for online-only' })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;
}
