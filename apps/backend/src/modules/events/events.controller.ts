/**
 * EventsController — HTTP surface for apps/backend/src/modules/events.
 * Routes follow SPEC.md §17.3's GET /classrooms/:id/events plus the
 * create/RSVP/delete routes this task's own bullet list specifies under
 * /events/:classroomId — every route here requires a full session.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post(':classroomId')
  @ApiOperation({ summary: 'Create an event — verified members only, event_date must be in the future' })
  async create(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Body() dto: CreateEventDto,
    @Req() req: Request,
  ) {
    return this.eventsService.createEvent(authToken.sub, classroomId, dto, req);
  }

  @Get(':classroomId')
  @ApiOperation({ summary: 'List events, split into upcoming/past with RSVP counts and your own status' })
  async list(@CurrentUser() authToken: AuthTokenPayload, @Param('classroomId') classroomId: string) {
    return this.eventsService.listEvents(authToken.sub, classroomId);
  }

  @Get(':classroomId/:eventId')
  @ApiOperation({ summary: 'Single event with the full RSVP list by name' })
  async detail(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.eventsService.getEventDetail(authToken.sub, classroomId, eventId);
  }

  @Post(':classroomId/:eventId/rsvp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set (create or update) your RSVP status' })
  async rsvp(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('eventId') eventId: string,
    @Body() dto: RsvpDto,
    @Req() req: Request,
  ) {
    return this.eventsService.upsertRsvp(authToken.sub, classroomId, eventId, dto, req);
  }

  @Delete(':classroomId/:eventId/rsvp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove your RSVP' })
  async removeRsvp(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    await this.eventsService.removeRsvp(authToken.sub, classroomId, eventId);
  }

  @Delete(':classroomId/:eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an event — verified classroom admin only' })
  async remove(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('eventId') eventId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.eventsService.deleteEvent(authToken.sub, classroomId, eventId, req);
  }
}
