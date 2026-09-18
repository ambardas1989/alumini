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
