/**
 * MembershipController — HTTP surface for apps/backend/src/modules/membership.
 *
 * ROUTE ORDER: 'pending' is declared BEFORE the dynamic :classroomId route
 * — both are single-segment GET routes under /membership, and Nest
 * registers routes in declaration order. A literal segment must come
 * before a catch-all `:param` at the same depth or it would never be
 * reached (every request would match the dynamic one first) — same
 * reasoning as 'my' vs :idOrGlobalId in ClassroomController.
 *
 * Every route requires a full session — applied once at the controller
 * level rather than per-method.
 */

import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { MembershipService } from './membership.service';
import { ChangeRoleDto } from './dto/change-role.dto';
import { RejectMemberDto } from './dto/reject-member.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MfaChallengeGuard } from '../auth/guards/mfa-challenge.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('membership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('membership')
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  @Get('pending')
  @ApiOperation({ summary: 'Classrooms where the caller still has a pending verification' })
  async pending(@CurrentUser() authToken: AuthTokenPayload, @Query('page') page?: string) {
    const pageNumber = page ? parseInt(page, 10) : 0;
    return this.membershipService.getPendingVerifications(authToken.sub, pageNumber);
  }

  @Get(':classroomId')
  @ApiOperation({ summary: "The caller's own membership details for one classroom" })
  async getMembership(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
  ) {
    return this.membershipService.getMembership(authToken.sub, classroomId);
  }

  @Get(':classroomId/verification')
  @ApiOperation({ summary: "The caller's verification status for one classroom" })
  async verification(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
  ) {
    return this.membershipService.getVerificationStatus(authToken.sub, classroomId);
  }

  @Patch(':classroomId/role')
  @ApiOperation({ summary: "Promote/demote a member's role — verified classroom admin only" })
  async changeRole(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Body() dto: ChangeRoleDto,
    @Req() req: Request,
  ) {
    return this.membershipService.changeRole(authToken.sub, classroomId, dto, req);
  }

  /**
   * TASKS_09 TASK 12 FIX B — admin directly verifies ANY pending/
   * pending_auto member, not just ones who submitted a document (that's
   * VerificationService.adminApproveDocument()'s narrower job). MFA
   * required — SPEC.md §11.2 gates verification approve/reject on it, and
   * this grants the same privilege.
   */
  @Patch(':classroomId/members/:userId/verify')
  @UseGuards(MfaChallengeGuard)
  @ApiOperation({ summary: 'Admin directly verifies a pending/pending_auto member — verified classroom admin only, MFA required' })
  async verifyMember(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    return this.membershipService.adminVerifyMember(authToken.sub, classroomId, userId, req);
  }

  @Patch(':classroomId/members/:userId/reject')
  @UseGuards(MfaChallengeGuard)
  @ApiOperation({ summary: 'Admin rejects a pending/pending_auto member — verified classroom admin only, MFA required' })
  async rejectMember(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('classroomId') classroomId: string,
    @Param('userId') userId: string,
    @Body() dto: RejectMemberDto,
    @Req() req: Request,
  ) {
    return this.membershipService.adminRejectMember(authToken.sub, classroomId, userId, dto.reason, req);
  }
}
