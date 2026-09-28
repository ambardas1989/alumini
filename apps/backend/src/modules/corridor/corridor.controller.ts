/**
 * CorridorController — HTTP surface for apps/backend/src/modules/corridor.
 * Routes follow SPEC.md §17.4.
 *
 * CHANNEL VALIDATION: the `:channel` path param is parsed with
 * ParseEnumPipe(ChannelType), NestJS's built-in enum-validating pipe — it
 * throws a 400 BadRequestException automatically for anything outside
 * 'classroom' | 'staff_room' | 'student_alley', before the request ever
 * reaches CorridorService. This is the "reject anything else with 400"
 * requirement; no manual validation needed in the service.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { CorridorService } from './corridor.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ChannelType } from '@alumini/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('corridor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('corridor')
export class CorridorController {
  constructor(private readonly corridorService: CorridorService) {}

  /**
   * TASKS_09 TASK 24 — home feed's announcement cards. A single literal
   * segment, at a different depth than ':classroomId/:channel' below, so
   * there's no route-ordering ambiguity between them.
   */
  @Get('announcements')
  @ApiOperation({ summary: "Recent announcements across the caller's own classrooms, redacted per the same rules as the classroom channel itself" })
  async getRecentAnnouncements(@CurrentUser() authToken: AuthTokenPayload, @Query('limit') limit?: string) {
    const limitNumber = limit ? Math.min(parseInt(limit, 10) || 10, 30) : 10;
    return this.corridorService.getRecentAnnouncements(authToken.sub, limitNumber);
  }

  /** TASKS_09 TASK 25 — home feed's visiting-city cards, same shape/route-ordering reasoning as GET 'announcements' above. */
  @Get('visiting-city')
  @ApiOperation({ summary: "Recent visiting-city posts across the caller's own classrooms, redacted per the same rules as the classroom channel itself" })
  async getRecentVisitingCityPosts(@CurrentUser() authToken: AuthTokenPayload, @Query('limit') limit?: string) {
    const limitNumber = limit ? Math.min(parseInt(limit, 10) || 10, 30) : 10;
    return this.corridorService.getRecentVisitingCityPosts(authToken.sub, limitNumber);
  }

  @Get(':classroomId/:channel')
  @ApiOperation({ summary: 'Paginated messages for one channel — redacted for unverified members' })
  async getMessages(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('channel', new ParseEnumPipe(ChannelType)) channel: ChannelType,
    @Query('page') page?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 0;
    return this.corridorService.getMessages(authToken.sub, classroomId, channel, pageNumber);
  }

  @Post(':classroomId/:channel')
  @ApiOperation({ summary: 'Send a message — verified members with the right role for this channel only' })
  async sendMessage(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('channel', new ParseEnumPipe(ChannelType)) channel: ChannelType,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.corridorService.sendMessage(authToken.sub, classroomId, channel, dto, req);
  }

  /**
   * TASKS_09 TASK 25 — "I'm there too" response to a visiting_city post.
   * 3-segment literal-first path ('message'), same shape as the DELETE
   * route below but a different HTTP method — no route-ordering ambiguity.
   */
  @Post('message/:messageId/im-there')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Add the caller to a visiting_city post's responders (idempotent) — returns the updated responder count" })
  async imThere(@CurrentUser() authToken: AuthTokenPayload, @Param('messageId') messageId: string) {
    return this.corridorService.respondImThere(authToken.sub, messageId);
  }

  @Delete(':classroomId/message/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a message — own message, or a verified classroom admin deleting any message' })
  async deleteMessage(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('messageId') messageId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.corridorService.deleteMessage(authToken.sub, classroomId, messageId, req);
  }
}
