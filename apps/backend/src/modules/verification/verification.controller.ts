/**
 * VerificationController — HTTP surface for apps/backend/src/modules/verification.
 * Routes follow SPEC.md §17.5, plus GET /verify/status/:membershipId which
 * that section also lists.
 *
 * MFA: SPEC.md §11.2 lists "Approve/reject verification documents" among
 * the admin actions requiring MFA re-challenge — not restated in this
 * task's own bullet list, but directly applicable, so
 * document/:verificationId/approve and .../reject both layer
 * MfaChallengeGuard on top of JwtAuthGuard, the same pairing the
 * institution module uses for its admin-only routes.
 */

import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { VerificationService } from './verification.service';
import { InitiateEmailVerificationDto } from './dto/initiate-email-verification.dto';
import { ConfirmEmailOtpDto } from './dto/confirm-email-otp.dto';
import { VouchDto } from './dto/vouch.dto';
import { SubmitDocumentDto } from './dto/submit-document.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import { LinkedinVerifyDto } from './dto/linkedin-verify.dto';
import { RedeemCodeDto } from './dto/redeem-code.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MfaChallengeGuard } from '../auth/guards/mfa-challenge.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('verify')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('verify')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  // ── Method 1: Institutional email ────────────────────────────────────────

  @Post('email')
  @ApiOperation({ summary: 'Submit institutional email — sends a one-time code' })
  async initiateEmail(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: InitiateEmailVerificationDto,
    @Req() req: Request,
  ) {
    await this.verificationService.initiateEmailVerification(
      authToken.sub,
      dto.institutionalEmail,
      dto.classroomId,
      req,
    );
  }

  @Post('email/confirm')
  @ApiOperation({ summary: 'Confirm the institutional-email OTP' })
  async confirmEmail(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: ConfirmEmailOtpDto,
    @Req() req: Request,
  ) {
    return this.verificationService.confirmEmailOtp(authToken.sub, dto.classroomId, dto.otp, req);
  }

  // ── Method 2: Peer vouching ──────────────────────────────────────────────

  @Post('vouch')
  @ApiOperation({ summary: 'Vouch for another member of a classroom' })
  async vouch(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: VouchDto,
    @Req() req: Request,
  ) {
    return this.verificationService.addVouch(authToken.sub, dto.voucheeId, dto.classroomId, req);
  }

  // ── Method 3: Document upload ────────────────────────────────────────────

  @Post('document')
  @ApiOperation({ summary: 'Submit a document for admin review' })
  async submitDocument(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: SubmitDocumentDto,
    @Req() req: Request,
  ) {
    return this.verificationService.submitDocument(authToken.sub, dto.classroomId, dto.storagePath, req);
  }

  @Post('document/:verificationId/approve')
  @UseGuards(MfaChallengeGuard)
  @ApiOperation({ summary: 'Approve a document verification — verified classroom admin only, MFA required' })
  async approveDocument(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('verificationId') verificationId: string,
    @Req() req: Request,
  ) {
    await this.verificationService.adminApproveDocument(authToken.sub, verificationId, req);
  }

  @Post('document/:verificationId/reject')
  @UseGuards(MfaChallengeGuard)
  @ApiOperation({ summary: 'Reject a document verification — verified classroom admin only, MFA required' })
  async rejectDocument(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('verificationId') verificationId: string,
    @Body() dto: RejectDocumentDto,
    @Req() req: Request,
  ) {
    await this.verificationService.adminRejectDocument(authToken.sub, verificationId, dto.reason, req);
  }

  // ── Method 4: LinkedIn import ─────────────────────────────────────────────

  @Post('linkedin')
  @ApiOperation({ summary: 'Verify via LinkedIn education history' })
  async linkedin(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: LinkedinVerifyDto,
    @Req() req: Request,
  ) {
    return this.verificationService.verifyViaLinkedin(authToken.sub, dto.classroomId, req);
  }

  // ── Methods 5 & 6: Institution codes ─────────────────────────────────────

  @Post('code')
  @ApiOperation({ summary: 'Redeem a personal or batch institution code' })
  async redeemCode(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: RedeemCodeDto,
    @Req() req: Request,
  ) {
    return this.verificationService.redeemCode(authToken.sub, dto.classroomId, dto.code, req);
  }

  // ── Admin review queue (classroom-scoped) ────────────────────────────────

  /**
   * TASKS_09 TASK 10 — the admin dashboard's GET /admin/:institutionId/
   * verifications/pending lists pending document verifications across a
   * whole institution; this is the same data scoped to ONE classroom, for
   * the classroom members tab's own Pending filter. Authorization is
   * assertClassroomAdmin() (classroom-level admin/creator OR an active
   * school_admin of the institution) — the same check document approve/
   * reject already use below, not the admin module's institution-admin-only
   * gate, so a classroom creator who has no school_admin persona can still
   * review their own classroom's pending documents.
   */
  @Get('pending/:classroomId')
  @ApiOperation({ summary: 'Pending document verifications for one classroom — classroom admin/creator or school admin only' })
  async pendingForClassroom(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
  ) {
    return this.verificationService.listPendingDocumentVerifications(authToken.sub, classroomId);
  }

  // ── Status ───────────────────────────────────────────────────────────────

  @Get('status/:membershipId')
  @ApiOperation({
    summary:
      'Get verification status (and latest attempt detail) for a membership — ' +
      'the membership owner or a verified admin of that classroom only',
  })
  async status(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('membershipId') membershipId: string,
  ) {
    return this.verificationService.getStatusByMembership(authToken.sub, membershipId);
  }
}
