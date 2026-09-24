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

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  PayloadTooLargeException,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { IdentityService } from './identity.service';

/**
 * BUG FIX — Render's build environment failed with "TS2503: Cannot find
 * namespace 'Express'" on the `Express.Multer.File` annotation below,
 * despite @types/multer being correctly installed (its declare global
 * block for that namespace is genuinely present — confirmed by reading
 * node_modules/@types/multer's own .d.ts). Whatever differs between this
 * environment's install and Render's (most likely a stale build cache
 * from before @types/multer was added, or how the monorepo workspace
 * hoists devDependencies during Render's specific install step) isn't
 * reproducible or fixable from here — so this sidesteps depending on that
 * ambient global type resolving at all. A local structural type is all
 * this method actually needs (the same shape IdentityService.uploadAvatar()
 * already declares, deliberately not Express.Multer.File either), and
 * @UploadedFile() itself is a runtime decorator — the type annotation is
 * compile-time only and never affects what multer actually populates.
 */
interface UploadedAvatarFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AddPersonaDto } from './dto/add-persona.dto';
import { SwitchPersonaDto } from './dto/switch-persona.dto';
import { SaveLinkedinDto } from './dto/save-linkedin.dto';
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

  // ── Avatar (TASKS_07 TASK 11) ────────────────────────────────────────────

  private static readonly MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
  private static readonly ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  /**
   * Routed through the backend (service-role Supabase client) rather than
   * the frontend uploading straight to Storage — see
   * IdentityService.uploadAvatar()'s own comment for why that path can
   * never actually work for this app's custom-JWT sessions.
   */
  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  // Multer's own limit is a memory-safety backstop (rejects the upload
  // before it's fully buffered), set above the real 5MB business rule —
  // the explicit file.size check below is what actually produces the
  // clean 413 a normal over-limit upload should see.
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiOperation({ summary: "Upload the caller's profile avatar — multipart, field name 'avatar', max 5MB, JPEG/PNG/WebP" })
  async uploadAvatar(@CurrentUser() authToken: AuthTokenPayload, @UploadedFile() file?: UploadedAvatarFile) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    if (!IdentityController.ALLOWED_AVATAR_TYPES.includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException('Invalid file type. Use JPEG, PNG or WebP.');
    }
    if (file.size > IdentityController.MAX_AVATAR_SIZE_BYTES) {
      throw new PayloadTooLargeException('File too large. Maximum size is 5MB.');
    }

    return this.identityService.uploadAvatar(authToken.sub, file);
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

  // ── LinkedIn ─────────────────────────────────────────────────────────────

  @Post('linkedin/save')
  @ApiOperation({ summary: 'Save whichever LinkedIn-suggested fields the caller confirmed' })
  async saveLinkedin(@CurrentUser() authToken: AuthTokenPayload, @Body() dto: SaveLinkedinDto) {
    return this.identityService.saveLinkedin(authToken.sub, dto);
  }

  @Post('linkedin/disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect LinkedIn from the caller\'s profile' })
  async disconnectLinkedin(@CurrentUser() authToken: AuthTokenPayload): Promise<void> {
    await this.identityService.disconnectLinkedin(authToken.sub);
  }
}
