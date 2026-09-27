/**
 * UsersController — TASKS_09 TASK 20's platform-wide user search for the
 * messages tab's "New message" overlay. Lives in the identity module
 * (owns `profiles`) as its own controller rather than folded into
 * IdentityController — a distinct '/users' route, not '/identity/...'.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { IdentityService } from './identity.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly identityService: IdentityService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search any platform user by name (substring) or exact email — never returns email' })
  async search(@CurrentUser() authToken: AuthTokenPayload, @Query('q') q: string) {
    return this.identityService.searchUsers(authToken.sub, q ?? '');
  }
}
