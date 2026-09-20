import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { NotificationService } from './notification.service';
import { MarkReadDto } from './dto/mark-read.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('notification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'The caller\'s notifications, newest first' })
  async list(@CurrentUser() authToken: AuthTokenPayload, @Query('limit') limit?: string) {
    return this.notificationService.getNotifications(authToken.sub, limit ? parseInt(limit, 10) : 20);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count — cheap poll for a badge, no row data' })
  async unreadCount(@CurrentUser() authToken: AuthTokenPayload) {
    return { count: await this.notificationService.getUnreadCount(authToken.sub) };
  }

  @Post('mark-read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marks specific notifications read, or all of them with { all: true }' })
  async markRead(@CurrentUser() authToken: AuthTokenPayload, @Body() dto: MarkReadDto): Promise<void> {
    await this.notificationService.markRead(authToken.sub, dto.notificationIds, dto.all);
  }
}
