/**
 * InstitutionAdminController — HTTP surface for TASKS_11's institution-admin
 * dashboard "request and invite" flow (TASK 01).
 *
 * Deliberately a THIN wrapper around InstitutionService's existing
 * claim/invite/accept machinery (submitClaim/approveClaim/rejectClaim/
 * inviteAdmin/acceptInvite — SPEC.md §11) rather than a new parallel
 * system — see supabase/migrations/031_institution_admin_requests.sql's
 * own comment for why TASKS_11's originally-specified `institution_admins`
 * table was dropped in favour of extending what already existed.
 *
 * The approve/reject routes here are new: InstitutionController's own
 * header comment previously documented approveClaim()/rejectClaim() as
 * "deliberately NOT exposed to users, service-role only" — TASK 01
 * explicitly wants a platform-admin dashboard UI for this, so they're
 * exposed here, gated by InstitutionService.assertPlatformAdmin().
 */

import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { InstitutionService } from './institution.service';
import { RequestAdminAccessDto } from './dto/request-admin-access.dto';
import { ReviewAdminRequestDto } from './dto/review-admin-request.dto';
import { RejectClaimDto } from './dto/reject-claim.dto';
import { PlatformInviteAdminDto } from './dto/platform-invite-admin.dto';
import { AcceptAdminInviteDto } from './dto/accept-admin-invite.dto';
import { SendInstitutionAnnouncementDto } from './dto/send-institution-announcement.dto';
import { ListInstitutionMembersDto } from './dto/list-institution-members.dto';
import { ListInstitutionVerificationsDto } from './dto/list-institution-verifications.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('institution-admin')
@Controller('institution-admin')
export class InstitutionAdminController {
  constructor(private readonly institutionService: InstitutionService) {}

  @Post('request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request institution admin access — enters the platform-admin review queue' })
  async requestAccess(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: RequestAdminAccessDto,
    @Req() req: Request,
  ) {
    return this.institutionService.requestAdminAccess(authToken.sub, dto, req);
  }

  @Get('requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List institution admin requests (platform admin only)' })
  async listRequests(@CurrentUser() authToken: AuthTokenPayload, @Query('status') status?: string) {
    return this.institutionService.listAdminRequests(authToken.sub, status);
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a pending institution admin request (platform admin only)' })
  async approve(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') personaId: string,
    @Body() _dto: ReviewAdminRequestDto,
    @Req() req: Request,
  ) {
    return this.institutionService.approveClaim(authToken.sub, personaId, req);
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a pending institution admin request (platform admin only)' })
  async reject(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') personaId: string,
    @Body() dto: RejectClaimDto,
    @Req() req: Request,
  ) {
    await this.institutionService.rejectClaim(authToken.sub, personaId, dto, req);
    return { message: 'Request rejected' };
  }

  @Post('invite')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invite someone as an institution admin directly (platform admin only)' })
  async invite(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: PlatformInviteAdminDto,
    @Req() req: Request,
  ) {
    return this.institutionService.platformInviteAdmin(authToken.sub, dto, req);
  }

  @Get('invite-preview')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Preview an institution admin invite (institution name) without consuming it' })
  async previewInvite(@Query('token') token: string) {
    return this.institutionService.previewInvite(token);
  }

  @Post('accept-invite')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept an institution admin invitation (must be logged in)' })
  async acceptInvite(@Body() dto: AcceptAdminInviteDto, @Req() req: Request) {
    return this.institutionService.acceptInvite(dto.token, req);
  }

  // ── Announcements (TASKS_11 TASK 08) ─────────────────────────────────────

  @Get(':id/announcements')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List past announcements for this institution, newest first' })
  async listAnnouncements(@CurrentUser() authToken: AuthTokenPayload, @Param('id') institutionId: string) {
    return this.institutionService.listAnnouncements(authToken.sub, institutionId);
  }

  @Get(':id/announcements/recipient-count')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Preview how many members a would-be announcement would reach' })
  async getAnnouncementRecipientCount(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Query('target') target: 'all' | 'specific',
    @Query('classroomIds') classroomIds?: string,
  ) {
    return this.institutionService.getAnnouncementRecipientCount(
      authToken.sub,
      institutionId,
      target,
      classroomIds ? classroomIds.split(',').filter(Boolean) : undefined,
    );
  }

  @Post(':id/announcements')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send an announcement to all or specific-classroom verified members' })
  async sendAnnouncement(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Body() dto: SendInstitutionAnnouncementDto,
    @Req() req: Request,
  ) {
    return this.institutionService.sendAnnouncement(authToken.sub, institutionId, dto, req);
  }

  // ── Member management (TASKS_11 TASK 09) ─────────────────────────────────

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search/filter members across every classroom of this institution' })
  async listMembers(@CurrentUser() authToken: AuthTokenPayload, @Param('id') institutionId: string, @Query() dto: ListInstitutionMembersDto) {
    return this.institutionService.listMembers(authToken.sub, institutionId, dto);
  }

  @Get(':id/members/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Full member profile + all of this user's memberships within the institution" })
  async getMemberDetail(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.institutionService.getMemberDetail(authToken.sub, institutionId, targetUserId);
  }

  // ── Verification management (TASKS_11 TASK 10) ───────────────────────────
  // Approve/reject stay on AdminController's existing MFA-gated document
  // routes (see InstitutionService.listVerifications()'s own comment) —
  // this is the broader list/filter view only.

  @Get(':id/verifications')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List verification requests across every classroom of this institution, any method/status' })
  async listVerifications(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Query() dto: ListInstitutionVerificationsDto,
  ) {
    return this.institutionService.listVerifications(authToken.sub, institutionId, dto);
  }
}
