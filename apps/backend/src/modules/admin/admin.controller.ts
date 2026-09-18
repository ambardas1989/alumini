/**
 * AdminController — HTTP surface for apps/backend/src/modules/admin.
 * Routes follow SPEC.md §11 / §17.6.
 *
 * GUARDS: JwtAuthGuard is applied once at the controller level (every
 * route requires a session). MfaChallengeGuard is layered on top per-route
 * for every mutating operation only (approve/reject document, approve/
 * reject claim) — task's explicit requirement; the read/list routes do
 * not require MFA re-challenge.
 *
 * ROUTE SHAPE NOTE: /admin/:institutionId/... and /admin/claims/... look
 * like they could collide (":institutionId" could match the literal
 * string "claims"), but every one of these routes has a distinct literal
 * final segment (overview/classrooms/analytics vs pending/approve/reject)
 * at the SAME depth as its near-collision counterpart, so Express's exact
 * literal-segment matching never actually confuses them — verified by the
 * full test suite hitting every route. No special declaration order was
 * needed here, unlike ClassroomController's :idOrGlobalId vs 'my'.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { AdminService } from './admin.service';
import { RejectVerificationDocumentDto } from './dto/reject-verification-document.dto';
import { RejectInstitutionClaimDto } from './dto/reject-institution-claim.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MfaChallengeGuard } from '../auth/guards/mfa-challenge.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Dashboard ────────────────────────────────────────────────────────────

  @Get(':institutionId/overview')
  @ApiOperation({ summary: 'Dashboard overview — classrooms, verified members, pending verifications, active codes, admins' })
  async overview(@CurrentUser() authToken: AuthTokenPayload, @Param('institutionId') institutionId: string) {
    return this.adminService.getOverview(authToken.sub, institutionId);
  }

  @Get(':institutionId/classrooms')
  @ApiOperation({ summary: 'Classrooms grouped by batch year, descending, with per-classroom member/verified/pending counts' })
  async classrooms(@CurrentUser() authToken: AuthTokenPayload, @Param('institutionId') institutionId: string) {
    return this.adminService.getClassroomsByYear(authToken.sub, institutionId);
  }

  @Get(':institutionId/analytics')
  @ApiOperation({ summary: 'Active alumni count, top 5 classrooms, verification method breakdown, new members this month' })
  async analytics(@CurrentUser() authToken: AuthTokenPayload, @Param('institutionId') institutionId: string) {
    return this.adminService.getAnalytics(authToken.sub, institutionId);
  }

  // ── Verification queue ───────────────────────────────────────────────────

  @Get(':institutionId/verifications/pending')
  @ApiOperation({ summary: 'All pending document verifications across the institution (no document paths — see the /document endpoint)' })
  async pendingVerifications(@CurrentUser() authToken: AuthTokenPayload, @Param('institutionId') institutionId: string) {
    return this.adminService.getPendingDocumentVerifications(authToken.sub, institutionId);
  }

  @Get(':institutionId/verifications/:verificationId/document')
  @ApiOperation({ summary: 'Signed URL for a verification document (1hr expiry) — every access is audited' })
  async verificationDocument(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('institutionId') institutionId: string,
    @Param('verificationId') verificationId: string,
    @Req() req: Request,
  ) {
    return this.adminService.getVerificationDocumentUrl(authToken.sub, institutionId, verificationId, req);
  }

  @Post(':institutionId/verifications/:verificationId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(MfaChallengeGuard)
  @ApiOperation({ summary: 'Approve a document verification (delegates to VerificationService) — MFA required' })
  async approveVerification(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('institutionId') institutionId: string,
    @Param('verificationId') verificationId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.adminService.approveVerificationDocument(authToken.sub, institutionId, verificationId, req);
  }

  @Post(':institutionId/verifications/:verificationId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(MfaChallengeGuard)
  @ApiOperation({ summary: 'Reject a document verification (delegates to VerificationService) — MFA required' })
  async rejectVerification(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('institutionId') institutionId: string,
    @Param('verificationId') verificationId: string,
    @Body() dto: RejectVerificationDocumentDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.adminService.rejectVerificationDocument(authToken.sub, institutionId, verificationId, dto, req);
  }

  // ── Institution claims (platform admin only) ─────────────────────────────

  @Get('claims/pending')
  @ApiOperation({ summary: 'List all pending institution claims — platform admin only' })
  async pendingClaims(@CurrentUser() authToken: AuthTokenPayload) {
    return this.adminService.listPendingClaims(authToken.sub);
  }

  @Post('claims/:claimId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(MfaChallengeGuard)
  @ApiOperation({ summary: 'Approve an institution claim (delegates to InstitutionService) — platform admin only, MFA required' })
  async approveClaim(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('claimId') claimId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.adminService.approveClaim(authToken.sub, claimId, req);
  }

  @Post('claims/:claimId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(MfaChallengeGuard)
  @ApiOperation({ summary: 'Reject an institution claim (delegates to InstitutionService) — platform admin only, MFA required' })
  async rejectClaim(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('claimId') claimId: string,
    @Body() dto: RejectInstitutionClaimDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.adminService.rejectClaim(authToken.sub, claimId, dto, req);
  }
}
