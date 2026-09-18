/**
 * IdentityController — HTTP surface for apps/backend/src/modules/identity.
 * Not part of SPEC.md §17's explicit endpoint list (that section only
 * enumerates auth/classroom/message/verification/admin) — these routes are
 * derived directly from SPEC.md §6's persona rules and §5.4's "adding a
 * persona to an existing account" flow.
 *
 * Every route requires a full access token — reuses JwtAuthGuard from the
 * auth module rather than re-implementing token verification.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { IdentityService } from './identity.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AddPersonaDto } from './dto/add-persona.dto';
import { SwitchPersonaDto } from './dto/switch-persona.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('identity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('identity')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  // ── Profile ──────────────────────────────────────────────────────────────

  @Get('profile')
  @ApiOperation({ summary: "Get the caller's own profile" })
  async getProfile(@CurrentUser() authToken: AuthTokenPayload) {
    return this.identityService.getProfile(authToken.sub);
  }

  @Patch('profile')
  @ApiOperation({ summary: "Update the caller's own profile" })
  async updateProfile(@CurrentUser() authToken: AuthTokenPayload, @Body() dto: UpdateProfileDto) {
    return this.identityService.updateProfile(authToken.sub, dto);
  }

  // ── Personas ─────────────────────────────────────────────────────────────

  @Get('personas')
  @ApiOperation({ summary: "List every persona on the caller's account" })
  async listPersonas(@CurrentUser() authToken: AuthTokenPayload) {
    return this.identityService.listPersonas(authToken.sub);
  }

  @Post('personas')
  @ApiOperation({
    summary:
      'Add a new persona — alumni/teacher go active immediately, school_admin starts pending_approval',
  })
  async addPersona(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: AddPersonaDto,
    @Req() req: Request,
  ) {
    return this.identityService.addPersona(authToken.sub, dto, req);
  }

  @Post('personas/switch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch the active persona — instant, no re-login required' })
  async switchPersona(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: SwitchPersonaDto,
    @Req() req: Request,
  ) {
    return this.identityService.switchPersona(authToken.sub, dto, req);
  }
}
