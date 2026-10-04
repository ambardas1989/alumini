/**
 * InstitutionController — HTTP surface for apps/backend/src/modules/institution.
 * Routes follow SPEC.md §11 literally where it specifies them (the four
 * co-admin management routes); search/claim/invite-accept routes are
 * derived from SPEC.md §5/§7/§11.1/§11.3's described flows, since §17
 * doesn't enumerate an "Institution Endpoints" section.
 *
 * TASKS_11 TASK 01 update: approveClaim()/rejectClaim() are now exposed,
 * but via InstitutionAdminController (platform-admin dashboard), not here
 * — this controller previously documented them as "deliberately not
 * exposed, service-role only" per SPEC.md §3.4; that's no longer accurate
 * now that TASK 01 explicitly wants a platform-admin review UI for them.
 *
 * Literal routes (search, invite/accept) are declared before the `:id`
 * routes below as a defensive convention, even though their fixed path
 * segments don't actually collide with any `:id/...` pattern here.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { InstitutionService } from './institution.service';
import { SearchInstitutionsDto } from './dto/search-institutions.dto';
import { RequestInstitutionDto } from './dto/request-institution.dto';
import { ClaimInstitutionDto } from './dto/claim-institution.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { RemoveAdminDto } from './dto/remove-admin.dto';
import { TransferPrimaryAdminDto } from './dto/transfer-admin.dto';
import { UpdateInstitutionProfileDto } from './dto/update-institution-profile.dto';
import { RequestSubscriptionUpgradeDto } from './dto/request-subscription-upgrade.dto';
import { UpdateInstitutionSubscriptionDto } from './dto/update-institution-subscription.dto';
import { SetClassroomAdminRoleDto } from './dto/set-classroom-admin-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MfaChallengeGuard } from '../auth/guards/mfa-challenge.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

// Same reasoning as IdentityController's UploadedAvatarFile — a local
// structural type instead of Express.Multer.File, see its own comment.
interface UploadedLogoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

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

  // ── Institution requests (proposing a new institution) ──────────────────

  @Post('request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request a new institution not yet in the database' })
  async request(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: RequestInstitutionDto,
    @Req() req: Request,
  ) {
    return this.institutionService.requestInstitution(authToken.sub, dto, req);
  }

  @Get('my-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Institution requests the caller has submitted' })
  async myRequests(@CurrentUser() authToken: AuthTokenPayload) {
    return this.institutionService.getMyInstitutionRequests(authToken.sub);
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

  // ── Logo ─────────────────────────────────────────────────────────────────

  // TASKS_08 TASK 04 — routed through the backend's service-role Supabase
  // client instead of the frontend uploading straight to Storage, same fix
  // pattern as ClassroomController.updateCover() (see its own comment).
  // Permission stays "platform admin or an active institution admin" (not
  // narrowed to platform-admin-only per the task's literal text) —
  // InstitutionService.updateLogo() already enforces this and OverviewTab
  // relies on institution admins being able to upload their own logo; the
  // bug being fixed here is the upload mechanism, not who's allowed to use it.
  private static readonly MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024;
  private static readonly ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  @Post(':id/logo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiOperation({ summary: "Upload the institution logo — multipart, field name 'logo', max 5MB, JPEG/PNG/WebP (platform admin or an active institution admin)" })
  async updateLogo(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @UploadedFile() file?: UploadedLogoFile,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    if (!InstitutionController.ALLOWED_LOGO_TYPES.includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException('Invalid file type. Use JPEG, PNG or WebP.');
    }
    if (file.size > InstitutionController.MAX_LOGO_SIZE_BYTES) {
      throw new PayloadTooLargeException('File too large. Maximum size is 5MB.');
    }

    return this.institutionService.uploadLogo(authToken.sub, institutionId, file);
  }

  // ── Profile / branding (TASKS_11 TASK 03) ────────────────────────────────

  @Get(':id/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Full institution profile (platform admin or an active institution admin)' })
  async getProfile(@CurrentUser() authToken: AuthTokenPayload, @Param('id') institutionId: string) {
    return this.institutionService.getProfile(authToken.sub, institutionId);
  }

  @Patch(':id/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update institution profile fields (platform admin or an active institution admin)' })
  async updateProfile(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Body() dto: UpdateInstitutionProfileDto,
    @Req() req: Request,
  ) {
    return this.institutionService.updateProfile(authToken.sub, institutionId, dto, req);
  }

  @Post(':id/cover-photo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('coverPhoto', { limits: { fileSize: 12 * 1024 * 1024 } }))
  @ApiOperation({ summary: "Upload the institution cover photo — multipart, field name 'coverPhoto', max 10MB, JPEG/PNG/WebP (platform admin or an active institution admin)" })
  async updateCoverPhoto(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @UploadedFile() file?: UploadedLogoFile,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    if (!InstitutionController.ALLOWED_LOGO_TYPES.includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException('Invalid file type. Use JPEG, PNG or WebP.');
    }
    if (file.size > InstitutionController.MAX_LOGO_SIZE_BYTES) {
      throw new PayloadTooLargeException('File too large. Maximum size is 10MB.');
    }

    return this.institutionService.uploadCoverPhoto(authToken.sub, institutionId, file);
  }

  // ── Subscription (TASKS_11 TASK 04) ──────────────────────────────────────

  @Get(':id/subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current subscription status (platform admin or an active institution admin)' })
  async getSubscription(@CurrentUser() authToken: AuthTokenPayload, @Param('id') institutionId: string) {
    return this.institutionService.getSubscription(authToken.sub, institutionId);
  }

  @Post(':id/subscription/request-upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request a Tier 3 upgrade (platform admin or an active institution admin)' })
  async requestSubscriptionUpgrade(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Body() dto: RequestSubscriptionUpgradeDto,
    @Req() req: Request,
  ) {
    return this.institutionService.requestSubscriptionUpgrade(authToken.sub, institutionId, dto, req);
  }

  @Patch(':id/subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update subscription plan/status/limits (platform admin only)' })
  async updateSubscription(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Body() dto: UpdateInstitutionSubscriptionDto,
    @Req() req: Request,
  ) {
    return this.institutionService.updateSubscription(authToken.sub, institutionId, dto, req);
  }

  // ── Co-admin roster ──────────────────────────────────────────────────────

  @Get(':id/admins')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active/pending admins and outstanding invites for an institution' })
  async listAdmins(@CurrentUser() authToken: AuthTokenPayload, @Param('id') institutionId: string) {
    return this.institutionService.listAdmins(authToken.sub, institutionId);
  }

  // ── Classroom-level admin roster + promote/demote (TASKS_11 TASK 05) ────

  @Get(':id/classroom-admins')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List members with role=admin across every classroom of this institution' })
  async listClassroomAdmins(@CurrentUser() authToken: AuthTokenPayload, @Param('id') institutionId: string) {
    return this.institutionService.listClassroomAdmins(authToken.sub, institutionId);
  }

  @Patch(':id/classroom-admins')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Promote or demote a member\'s classroom-level role (platform admin or an active institution admin)' })
  async setClassroomAdminRole(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') institutionId: string,
    @Body() dto: SetClassroomAdminRoleDto,
    @Req() req: Request,
  ) {
    return this.institutionService.setClassroomAdminRole(authToken.sub, institutionId, dto, req);
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
