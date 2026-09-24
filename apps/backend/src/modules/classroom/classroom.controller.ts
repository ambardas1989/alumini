/**
 * ClassroomController — HTTP surface for apps/backend/src/modules/classroom.
 *
 * PATH NAMING: SPEC.md §17.3 lists these under the plural "/classrooms",
 * but every module actually built so far (auth, identity, institution)
 * uses a singular @Controller() matching its own module name, and this
 * task's literal endpoint list ("POST /classroom", "GET /classroom/:globalId",
 * ...) uses the singular form too — that's what's implemented here.
 *
 * ROUTE MERGE: the task/spec list "GET /classroom/:globalId" and
 * "GET /classroom/:id" as if they were separate routes, but they are
 * literally the same path shape (one dynamic segment) — a router cannot
 * register two distinct handlers for that; whichever is declared first
 * would swallow every request meant for the other. They're merged into one
 * handler, getOne(), which detects a UUID vs. a global-ID-shaped string —
 * see ClassroomService.getByIdOrGlobalId() for the full reasoning.
 *
 * ROUTE ORDER: 'my' is declared BEFORE the dynamic :idOrGlobalId route.
 * Nest registers routes in declaration order, and a literal path segment
 * must be declared before a catch-all `:param` at the same depth, or the
 * literal route would never be reached (every request would match the
 * dynamic one first).
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

import { ClassroomService } from './classroom.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';
import { JoinClassroomDto } from './dto/join-classroom.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

// Same reasoning as IdentityController's UploadedAvatarFile — a local
// structural type instead of Express.Multer.File, see its own comment.
interface UploadedCoverFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@ApiTags('classroom')
@Controller('classroom')
export class ClassroomController {
  constructor(private readonly classroomService: ClassroomService) {}

  // ── Create ───────────────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a classroom — generates the global ID, duplicate-checks first' })
  async create(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: CreateClassroomDto,
    @Req() req: Request,
  ) {
    return this.classroomService.createClassroom(authToken.sub, dto, req);
  }

  // ── Lookup ───────────────────────────────────────────────────────────────

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "All of the caller's classrooms, grouped by institution (teacher filing cabinet view)",
  })
  async myClassrooms(@CurrentUser() authToken: AuthTokenPayload) {
    return this.classroomService.getClassroomsByInstitution(authToken.sub);
  }

  /**
   * TASKS_07 TASK 07 — "Find your batch" discovery search. 'search' is a
   * literal path segment and must be declared before the dynamic
   * :idOrGlobalId route below, same reasoning as 'my' above — otherwise
   * a request to /classroom/search would be swallowed by getOne() with
   * idOrGlobalId="search" instead.
   */
  @Get('search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search classrooms platform-wide by institution name or global ID, excluding ones the caller already joined' })
  async search(@CurrentUser() authToken: AuthTokenPayload, @Query('q') q: string, @Query('limit') limit?: string) {
    const limitNumber = limit ? Math.min(parseInt(limit, 10) || 10, 50) : 10;
    return this.classroomService.searchClassrooms(authToken.sub, q ?? '', limitNumber);
  }

  @Get(':idOrGlobalId')
  @ApiOperation({ summary: 'Classroom details by internal id or global id — public, for deep links' })
  async getOne(@Param('idOrGlobalId') idOrGlobalId: string) {
    return this.classroomService.getByIdOrGlobalId(idOrGlobalId);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Member list — real names/avatars only for verified members; redacted otherwise',
  })
  async members(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') classroomId: string,
    @Query('page') page?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 0;
    return this.classroomService.getMembers(classroomId, authToken.sub, pageNumber);
  }

  // ── Join / leave ─────────────────────────────────────────────────────────

  @Post(':id/join')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Join a classroom — creates a pending (unverified) membership' })
  async join(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') classroomId: string,
    @Body() _dto: JoinClassroomDto,
    @Req() req: Request,
  ) {
    return this.classroomService.joinClassroom(authToken.sub, classroomId, req);
  }

  @Delete(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leave a classroom — blocked if you are its only admin' })
  async leave(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') classroomId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.classroomService.leaveClassroom(authToken.sub, classroomId, req);
  }

  // ── Admin settings ───────────────────────────────────────────────────────

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update classroom settings — verified admin of this classroom only' })
  async update(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') classroomId: string,
    @Body() dto: UpdateClassroomDto,
    @Req() req: Request,
  ) {
    return this.classroomService.updateClassroom(classroomId, authToken.sub, dto, req);
  }

  // TASKS_08 TASK 04 — routed through the backend's service-role Supabase
  // client instead of the frontend uploading straight to Storage, same fix
  // pattern and same root cause as IdentityController.uploadAvatar() (see
  // its own comment) — Storage's RLS is keyed on auth.uid(), which is
  // always NULL for this app's custom-JWT sessions.
  private static readonly MAX_COVER_SIZE_BYTES = 10 * 1024 * 1024;
  private static readonly ALLOWED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  @Post(':id/cover')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('cover', { limits: { fileSize: 12 * 1024 * 1024 } }))
  @ApiOperation({ summary: "Upload the classroom cover photo — multipart, field name 'cover', max 10MB, JPEG/PNG/WebP, verified admin of this classroom only" })
  async updateCover(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') classroomId: string,
    @UploadedFile() file?: UploadedCoverFile,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    if (!ClassroomController.ALLOWED_COVER_TYPES.includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException('Invalid file type. Use JPEG, PNG or WebP.');
    }
    if (file.size > ClassroomController.MAX_COVER_SIZE_BYTES) {
      throw new PayloadTooLargeException('File too large. Maximum size is 10MB.');
    }

    return this.classroomService.uploadCover(classroomId, authToken.sub, file);
  }
}
