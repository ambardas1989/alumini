import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DmService } from './dm.service';
import { SendDmDto } from './dto/send-dm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('dm')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dm')
export class DmController {
  constructor(private readonly dmService: DmService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'List the caller\'s DM conversations, most recent first' })
  async getConversations(@CurrentUser() authToken: AuthTokenPayload) {
    return this.dmService.getConversations(authToken.sub);
  }

  @Get('conversations/:userId')
  @ApiOperation({ summary: 'Paginated thread with one other user' })
  async getMessages(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('userId') userId: string,
    @Query('page') page?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 0;
    return this.dmService.getMessages(authToken.sub, userId, pageNumber);
  }

  @Post('conversations/:userId')
  @ApiOperation({ summary: 'Send a direct message' })
  async sendMessage(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('userId') userId: string,
    @Body() dto: SendDmDto,
  ) {
    return this.dmService.sendMessage(authToken.sub, userId, dto.content);
  }

  @Post('conversations/:userId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark every unread message from this user as read' })
  async markRead(@CurrentUser() authToken: AuthTokenPayload, @Param('userId') userId: string): Promise<void> {
    await this.dmService.markRead(authToken.sub, userId);
  }
}
