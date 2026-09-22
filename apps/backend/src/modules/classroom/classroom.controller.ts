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
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { ClassroomService } from './classroom.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';
import { JoinClassroomDto } from './dto/join-classroom.dto';
import { UpdateCoverDto } from './dto/update-cover.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

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

  @Post(':id/cover')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set the classroom cover photo — verified admin of this classroom only' })
  async updateCover(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('id') classroomId: string,
    @Body() dto: UpdateCoverDto,
  ) {
    return this.classroomService.updateCover(classroomId, authToken.sub, dto.coverUrl);
  }
}
