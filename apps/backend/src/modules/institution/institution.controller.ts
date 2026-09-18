/**
 * InstitutionController — HTTP surface for apps/backend/src/modules/institution.
 * Routes follow SPEC.md §11 literally where it specifies them (the four
 * co-admin management routes); search/claim/invite-accept routes are
 * derived from SPEC.md §5/§7/§11.1/§11.3's described flows, since §17
 * doesn't enumerate an "Institution Endpoints" section.
 *
 * There is deliberately NO route for approving/rejecting a claim —
 * InstitutionService.approveClaim()/rejectClaim() exist and are fully
 * tested, but SPEC.md §3.4 makes platform-admin review service-role-only,
 * "never exposed to users". See InstitutionService's module comment.
 *
 * Literal routes (search, invite/accept) are declared before the `:id`
 * routes below as a defensive convention, even though their fixed path
 * segments don't actually collide with any `:id/...` pattern here.
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { InstitutionService } from './institution.service';
import { SearchInstitutionsDto } from './dto/search-institutions.dto';
import { ClaimInstitutionDto } from './dto/claim-institution.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { RemoveAdminDto } from './dto/remove-admin.dto';
import { TransferPrimaryAdminDto } from './dto/transfer-admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MfaChallengeGuard } from '../auth/guards/mfa-challenge.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('institution')
@Controller('institution')
export class InstitutionController {
  constructor(private readonly institutionService: InstitutionService) {}

  // ── Search ───────────────────────────────────────────────────────────────

  @Get('search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Institution autocomplete search' })
  async search(@Query() dto: SearchInstitutionsDto) {
    return this.institutionService.searchInstitutions(dto);
  }

  // ── Co-admin invite acceptance (public — the token is the credential) ────

  @Get('invite/accept')
  @ApiOperation({ summary: 'Accept a co-admin invitation via its magic-link token' })
  async acceptInvite(@Query('token') token: string, @Req() req: Request) {
    return this.institutionService.acceptInvite(token, req);
  }

  // ── Claim ────────────────────────────────────────────────────────────────

  @Post(':id/claim')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Claim an unclaimed institution — enters the platform-admin review queue' })
  async claim(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Body() dto: ClaimInstitutionDto,
    @Req() req: Request,
  ) {
    return this.institutionService.submitClaim(authToken.sub, institutionId, dto, req);
  }

  // ── Co-admin roster ──────────────────────────────────────────────────────

  @Get(':id/admins')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active/pending admins and outstanding invites for an institution' })
  async listAdmins(@CurrentUser() authToken: AuthTokenPayload, @Param('id') institutionId: string) {
    return this.institutionService.listAdmins(authToken.sub, institutionId);
  }

  // ── Co-admin management (primary admin only, MFA re-challenge) ──────────

  @Post(':id/admins/invite')
  @UseGuards(JwtAuthGuard, MfaChallengeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invite a co-admin by email (magic link, primary admin only, MFA required)' })
  async inviteAdmin(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Body() dto: InviteAdminDto,
    @Req() req: Request,
  ) {
    return this.institutionService.inviteAdmin(authToken.sub, institutionId, dto, req);
  }

  @Delete(':id/admins/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, MfaChallengeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a co-admin (primary admin only, MFA required)' })
  async removeAdmin(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Param('userId') userId: string,
    @Body() dto: RemoveAdminDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.institutionService.removeAdmin(authToken.sub, institutionId, userId, dto, req);
  }

  @Post(':id/admins/transfer')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, MfaChallengeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Transfer the primary admin role (primary admin only, MFA required)' })
  async transferAdmin(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Body() dto: TransferPrimaryAdminDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.institutionService.transferPrimaryAdmin(authToken.sub, institutionId, dto, req);
  }
}
