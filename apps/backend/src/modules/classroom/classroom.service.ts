/**
 * ClassroomService — classroom creation, lookup, membership (join/leave),
 * member-list redaction, admin settings, and the filing cabinet view.
 *
 * Key responsibilities:
 * - Generate globally unique classroom IDs
 * - Prevent duplicate classrooms (check before create)
 * - Auto-add creator as verified admin member
 * - Organise classrooms by institution for teacher filing cabinet view
 * - Join/leave membership, with the sole-admin-can't-leave guard
 * - Server-side name redaction for unverified members (SPEC.md §18.2 —
 *   "Never rely on frontend-only blurring")
 * - Admin-only classroom settings updates
 *
 * NOTE: searchInstitutions() used to live here but has moved to
 * InstitutionModule (institution/ owns "the institution database" per
 * SPEC.md §15.3) — do not re-add it here.
 */

import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuditService } from '../audit/audit.service';
import { AuditEventType, ErrorCode, PersonaType } from '@alumini/types';
import { generateClassroomId, getRange, redactName, type ClassroomIdParams } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';
import { Request } from 'express';

/**
 * PostgREST column aliasing (`camelName:snake_column`) so query results
 * come back matching apps/web's Classroom type directly — see the BUG FIX
 * comment on createClassroom()'s insert().select() for why this exists
 * instead of the plain `*`/`.select()` this file used before.
 */
const CLASSROOM_SELECT_COLUMNS =
  'id, globalId:global_id, institutionId:institution_id, name, batchYear:batch_year, grade, section, program, hasStaffRoom:has_staff_room, hasStudentAlley:has_student_alley, requireVerification:require_verification, createdBy:created_by, memberCount:member_count, createdAt:created_at, coverUrl:cover_url';

/** Same reasoning as CLASSROOM_SELECT_COLUMNS, for the institution row joined into getByGlobalId()/getById(). */
const INSTITUTION_JOIN_COLUMNS = 'id, name, slug, type, cityCode:city_code, countryCode:country_code, logoUrl:logo_url';

@Injectable()
export class ClassroomService {
  private readonly logger = new Logger(ClassroomService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {
    // Use service role to bypass RLS for server-side operations
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  /**
   * Create a new classroom.
   *
   * Flow:
   * 1. Fetch institution to get country/city codes for ID generation
   * 2. Generate global ID
   * 3. Check for duplicate (global_id already exists)
   * 4. Insert classroom
   * 5. Auto-add creator as verified admin
   * 6. Emit classroom.created event (triggers welcome system message)
   * 7. Write audit log
   *
   * @param creatorId - User ID of the person creating the classroom
   * @param dto - Validated creation data
   * @param req - Express request (for audit IP logging)
   *
   * IMPORTANT: The classroom creator is always assigned
   * role='admin' regardless of their persona.
   * This is by design — the creator manages the classroom.
   *
   * For testing channel access:
   * - Do NOT use the creator account (always admin)
   * - Create a second account and JOIN as student
   * - Test Staff Room restriction from student account
   * - Test Student Alley access from student account
   */
  async createClassroom(
    creatorId: string,
    dto: CreateClassroomDto,
    req?: Request,
  ) {
    // 1. Fetch institution details needed for ID generation
    const { data: institution, error: instError } = await this.supabase
      .from('institutions')
      .select('id, country_code, city_code, slug, type')
      .eq('id', dto.institutionId)
      .single();

    if (instError || !institution) {
      throw new BadRequestException('Institution not found');
    }

    // Validate BEFORE generating the ID — generateClassroomId() throws a
    // plain Error (not an HttpException) when neither is present, which
    // would otherwise surface as an unhandled 500 instead of a clean 400.
    if (!dto.grade && !dto.program) {
      throw new BadRequestException(
        'Either grade (for schools) or program (for colleges) must be provided',
      );
    }

    // 2. Generate the globally unique classroom ID
    const idParams: ClassroomIdParams = {
      countryCode:     institution.country_code,
      cityCode:        institution.city_code ?? undefined,
      institutionSlug: institution.slug,
      grade:           dto.grade,
      section:         dto.section,
      program:         dto.program,
      batchYear:       dto.batchYear,
    };

    const globalId = generateClassroomId(idParams);

    // 3. Check for duplicate — show existing classroom instead of creating
    const { data: existing } = await this.supabase
      .from('classrooms')
      .select('id, global_id, member_count')
      .eq('global_id', globalId)
      .maybeSingle();

    if (existing) {
      throw new ConflictException({
        message: `Classroom ${globalId} already exists.`,
        error: ErrorCode.CLASSROOM_DUPLICATE,
        existingClassroomId: existing.id,
        globalId: existing.global_id,
        memberCount: existing.member_count,
        action: 'JOIN_INSTEAD',
      });
    }

    // 4. Create the classroom
    //
    // BUG FIX: this used to be a plain .select() (no column list), which
    // returns Supabase's raw snake_case row shape (global_id, batch_year,
    // ...) — but every consumer of this response (apps/web's Classroom
    // type, and this exact method's own callers) expects camelCase
    // (globalId, batchYear, ...). TypeScript's `as T` cast in the
    // frontend's request() never actually checks this at runtime, so
    // `classroom.globalId` silently read as `undefined` and
    // `router.push('/classroom/undefined')` followed. Aliasing the
    // select (`camelName:snake_column`) has PostgREST return the exact
    // shape the frontend already expects, so no frontend change is
    // needed — see CLASSROOM_SELECT_COLUMNS below, shared with
    // getByGlobalId()/getById() so the same fix covers loading a
    // classroom back after creating it.
    const { data: classroom, error: createError } = await this.supabase
      .from('classrooms')
      .insert({
        global_id:            globalId,
        institution_id:       dto.institutionId,
        name:                 dto.name,
        batch_year:           dto.batchYear,
        grade:                dto.grade ?? null,
        section:              dto.section ?? null,
        program:              dto.program ?? null,
        has_staff_room:       dto.hasStaffRoom ?? true,
        has_student_alley:    dto.hasStudentAlley ?? true,
        require_verification: dto.requireVerification ?? true,
        created_by:           creatorId,
      })
      .select(CLASSROOM_SELECT_COLUMNS)
      .single();

    if (createError || !classroom) {
      this.logger.error('Failed to create classroom', { error: createError, dto });
      throw new BadRequestException('Failed to create classroom. Please try again.');
    }

    // 5. Auto-add creator as verified admin
    // Creator bypasses verification — they are implicitly trusted as classroom admin
    //
    // FIX 1 investigation: confirmed this is intentional, not a bug — SPEC's
    // "creator is always admin" rule, unconditional on whatever persona
    // they hold. joinClassroom() (below) is the one that derives role from
    // the SECOND+ user's actual persona ('teacher' if they hold an active
    // teacher persona at this institution, 'student' otherwise) — it never
    // defaults to 'admin'. A user who creates a classroom rather than
    // joining an existing one becomes its admin regardless of their
    // intended role; that's this rule working as designed, not the bug.
    const { error: memberError } = await this.supabase
      .from('memberships')
      .insert({
        user_id:             creatorId,
        classroom_id:        classroom.id,
        role:                'admin',
        verification_status: 'verified',
        verification_method: 'creator',
        verified_at:         new Date().toISOString(),
      });

    if (memberError) {
      this.logger.error('Failed to add creator as admin member', { error: memberError });
      // Classroom was created — log the error but don't fail the whole operation
      // This should be extremely rare and is recoverable by the admin
    }

    // 6. Emit event — CorridorModule listens and posts a welcome system message
    this.events.emit('classroom.created', {
      classroomId: classroom.id,
      creatorId,
      globalId,
    });

    // 7. Write audit log
    await this.audit.log({
      eventType:  AuditEventType.CLASSROOM_CREATED,
      actorId:    creatorId,
      targetId:   classroom.id,
      targetType: 'classroom',
      metadata: {
        global_id:      globalId,
        institution_id: dto.institutionId,
        batch_year:     dto.batchYear,
      },
      persona: PersonaType.ALUMNI, // Classroom creation is an alumni/teacher action
      req,
    });

    this.logger.log(`Classroom created: ${globalId} by user ${creatorId}`);
    return classroom;
  }

  /**
   * Get a classroom by its global ID (used for deep links and invite links).
   *
   * Returns institution details joined in.
   * Does NOT check membership — public metadata is readable by all.
   */
  async getByGlobalId(globalId: string) {
    const { data, error } = await this.supabase
      .from('classrooms')
      .select(`
        ${CLASSROOM_SELECT_COLUMNS},
        institution:institutions (
          ${INSTITUTION_JOIN_COLUMNS}
        )
      `)
      .eq('global_id', globalId.toUpperCase())
      .single();

    if (error || !data) {
      throw new NotFoundException(`Classroom ${globalId} not found`);
    }

    return data;
  }

  /**
   * Get all classrooms for a user, organised by institution.
   * This powers the Teacher filing cabinet view.
   *
   * Returns:
   * {
   *   institution: { id, name, type, ... },
   *   classes: [
   *     { ...classroom, userRole, verificationStatus, isActive }
   *   ]  // sorted: active first, then by year desc
   * }[]
   */
  async getClassroomsByInstitution(userId: string) {
    // BUG FIX (TASK 07 — "NaN members" on classroom cards / "/classroom/
    // undefined" links): this used to select classroom/institution columns
    // by their raw snake_case names and spread the row straight into the
    // response. apps/web's Classroom/Institution types (and every screen
    // that renders this — home, teacher filing cabinet, profile) expect
    // camelCase (globalId, batchYear, memberCount, cityCode, countryCode),
    // so those fields silently read as undefined client-side: `undefined ??
    // 0` never ran (no such guard existed) so ICU plural formatting saw
    // NaN, and `/classroom/${undefined}` produced the broken link. Same
    // root cause and same fix pattern as createClassroom()/getByGlobalId()/
    // getById() above — reusing their CLASSROOM_SELECT_COLUMNS/
    // INSTITUTION_JOIN_COLUMNS aliases here instead of a third copy of the
    // same list.
    const { data: memberships, error } = await this.supabase
      .from('memberships')
      .select(`
        role,
        verification_status,
        classroom:classrooms (
          ${CLASSROOM_SELECT_COLUMNS},
          institution:institutions (
            ${INSTITUTION_JOIN_COLUMNS}
          )
        )
      `)
      .eq('user_id', userId);

    if (error) {
      this.logger.error('Failed to fetch classrooms for user', { error, userId });
      throw new BadRequestException('Failed to fetch classrooms');
    }

    if (!memberships || memberships.length === 0) return [];

    const currentYear = new Date().getFullYear();

    // Group by institution ID
    const byInstitution = memberships.reduce<
      Record<string, { institution: any; classes: any[] }>
    >((acc, m: any) => {
      const inst = m.classroom.institution;
      if (!acc[inst.id]) {
        acc[inst.id] = { institution: inst, classes: [] };
      }

      acc[inst.id].classes.push({
        ...m.classroom,
        userRole:           m.role,
        verificationStatus: m.verification_status,
        // Active window is config-driven, not hardcoded (appConfig.CLASSROOM_ACTIVE_YEAR_WINDOW)
        isActive:           m.classroom.batchYear >= currentYear - appConfig.CLASSROOM_ACTIVE_YEAR_WINDOW,
      });

      return acc;
    }, {});

    // Sort classes within each institution: active first, then by year descending
    for (const inst of Object.values(byInstitution)) {
      inst.classes.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.batchYear - a.batchYear;
      });
    }

    return Object.values(byInstitution);
  }

  // ── Lookup by internal id ────────────────────────────────────────────────

  /**
   * Get a classroom by its internal UUID, with institution details and
   * member_count joined in — same shape as getByGlobalId(). Public, same
   * as getByGlobalId(): both return only public classroom/institution
   * metadata, never member identities (that's getMembers()'s job, which
   * DOES enforce membership + redaction).
   */
  async getById(classroomId: string) {
    const { data, error } = await this.supabase
      .from('classrooms')
      .select(`
        ${CLASSROOM_SELECT_COLUMNS},
        institution:institutions (
          ${INSTITUTION_JOIN_COLUMNS}
        )
      `)
      .eq('id', classroomId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Classroom not found');
    }

    return data;
  }

  /**
   * Dispatches to getById() or getByGlobalId() depending on the shape of
   * the path parameter.
   *
   * WHY THIS EXISTS: the task/spec list "GET /classroom/:globalId" and
   * "GET /classroom/:id" as if they were two separate routes, but they are
   * literally the same path shape (one dynamic segment) — a router can't
   * register two distinct handlers for that, whichever is declared first
   * would swallow every request meant for the other. A global ID
   * ("IN-KOL-MPBIRLA-9A-2012") and an internal UUID are trivially
   * distinguishable by format, so ClassroomController exposes ONE route
   * that detects which one it got and calls the right lookup. Both
   * branches already return the same public shape, so callers don't need
   * to know which one matched.
   */
  async getByIdOrGlobalId(idOrGlobalId: string) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return UUID_RE.test(idOrGlobalId) ? this.getById(idOrGlobalId) : this.getByGlobalId(idOrGlobalId);
  }

  // ── Members (server-side redaction) ──────────────────────────────────────

  /**
   * Paginated member list. SPEC.md's "Member list with server-side
   * redaction" bullet and its separate "Redaction rules" bullet describe
   * non-member access slightly differently — the former implies a non-
   * member gets a redacted roster, the latter explicitly says a non-member
   * "can see classroom name and member count only". This implementation
   * follows the more explicit "Redaction rules" section: a non-member gets
   * NO roster at all (ForbiddenException) — they can still see the
   * classroom's name/member_count via getById()/getByGlobalId(). Documented
   * per the instruction to record assumptions where the spec is ambiguous.
   *
   * For members: verified members get real names/avatars; unverified
   * members get every name run through redactName() — including their OWN
   * row. SPEC.md §18.2: "Never rely on frontend-only blurring. Data must
   * not leave the server unredacted." Not carving out a self-exception
   * keeps the rule simple and avoids exactly the kind of special case that
   * tends to leak data later.
   */
  async getMembers(classroomId: string, requesterId: string, page = 0) {
    const { data: requesterMembership } = await this.supabase
      .from('memberships')
      .select('verification_status')
      .eq('user_id', requesterId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!requesterMembership) {
      throw new ForbiddenException({
        message:
          'Only members of this classroom can view its member list. Join first, or see the classroom summary instead.',
        error: ErrorCode.CLASSROOM_NOT_MEMBER,
      });
    }

    const isVerified = requesterMembership.verification_status === 'verified';
    const { from, to } = getRange(page, appConfig.MEMBERS_PAGE_SIZE);

    // BUG FIX (BACKEND FIX 2 — PGRST201): `memberships` has TWO foreign
    // keys into `profiles` (user_id and verified_by), so a bare
    // `profile:profiles(...)` embed is ambiguous to PostgREST and fails
    // every call. Same fix pattern as corridor.service.ts's identical
    // sender_id/deleted_by situation — the `!memberships_user_id_fkey`
    // hint disambiguates it. verified_by is intentionally not joined here —
    // not needed for the member list display.
    const { data: members, error } = await this.supabase
      .from('memberships')
      .select(
        'user_id, role, verification_status, joined_at, ' +
          'profile:profiles!memberships_user_id_fkey(id, full_name, avatar_url, linkedin_connected)',
      )
      .eq('classroom_id', classroomId)
      .order('joined_at', { ascending: true })
      .range(from, to);

    if (error) {
      this.logger.error('Failed to load members', { error, classroomId });
      throw new BadRequestException('Failed to load members');
    }

    return (members ?? []).map((m: any) => ({
      userId:             m.user_id,
      role:               m.role,
      verificationStatus: m.verification_status,
      joinedAt:           m.joined_at,
      // SECURITY: redaction happens here, server-side, unconditionally —
      // never send real names to an unverified viewer, not even partially.
      fullName:  isVerified ? m.profile?.full_name ?? null : redactName(m.profile?.full_name ?? ''),
      avatarUrl: isVerified ? m.profile?.avatar_url ?? null : null,
      // Not sensitive like name/avatar (it's just "has this person
      // connected LinkedIn", not their LinkedIn identity itself), so this
      // is shown regardless of the viewer's own verification status.
      linkedinConnected: m.profile?.linkedin_connected ?? false,
    }));
  }

  // ── Join / leave ──────────────────────────────────────────────────────────

  /**
   * Joins a classroom with a pending (unverified) membership.
   * Role defaults to 'student' unless the caller already holds an ACTIVE
   * teacher persona at this classroom's institution (SPEC.md §12.1's
   * filing cabinet is teacher-centric — this is how a teacher's own
   * memberships end up with role='teacher' rather than 'student').
   * verification_status is never set to 'verified' here — that's the
   * (unbuilt) verification module's job.
   */
  async joinClassroom(userId: string, classroomId: string, req?: Request) {
    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('id, institution_id, member_count')
      .eq('id', classroomId)
      .maybeSingle();

    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    // Friendlier than the raw UNIQUE(user_id, classroom_id) constraint violation.
    const { data: existing } = await this.supabase
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('You have already joined this classroom');
    }

    const { data: teacherPersona } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', userId)
      .eq('type', PersonaType.TEACHER)
      .eq('institution_id', classroom.institution_id)
      .eq('status', 'active')
      .maybeSingle();

    const role = teacherPersona ? 'teacher' : 'student';

    // Cold start: the classroom's creator is its only verified member at
    // first, so early joiners have nobody to vouch for them (peer_vouch)
    // and no one to approve a document — they'd be stuck read-only
    // indefinitely. member_count <= 3 means this join is at most the 4th
    // member overall (creator + 3 early joiners), which gets a distinct
    // 'pending_auto' status: still nudged to verify properly, but treated
    // as verified for messaging access (see 011_pending_auto_status.sql).
    const isEarlyJoiner = (classroom.member_count ?? 0) <= 3;

    const { data: membership, error } = await this.supabase
      .from('memberships')
      .insert({
        user_id:             userId,
        classroom_id:        classroomId,
        role,
        verification_status: isEarlyJoiner ? 'pending_auto' : 'pending',
        verification_method: isEarlyJoiner ? 'early_member' : null,
      })
      .select()
      .single();

    if (error || !membership) {
      this.logger.error('Failed to join classroom', { error, userId, classroomId });
      throw new BadRequestException('Failed to join this classroom. Please try again.');
    }

    // CorridorModule listens and posts a "X joined" system message.
    this.events.emit('classroom.joined', { classroomId, userId, role });

    await this.audit.log({
      eventType:  AuditEventType.CLASSROOM_JOINED,
      actorId:    userId,
      targetId:   classroomId,
      targetType: 'classroom',
      metadata:   { role },
      req,
    });

    return membership;
  }

  /**
   * Leaves a classroom. Blocked if the caller is the classroom's only
   * admin — SPEC.md's requirement that a classroom can't be left adminless.
   *
   * Hard-deletes the membership row (unlike personas, which are suspended
   * rather than deleted to preserve an admin-accountability trail —
   * memberships has no 'left' state in its schema at all —
   * 001_initial_schema.sql only defines pending/verified/rejected for
   * verification_status — and leaving a classroom is an ordinary,
   * reversible, high-frequency action, not one that needs a tombstone row).
   * The audit_logs entry below is the durable record regardless.
   */
  async leaveClassroom(userId: string, classroomId: string, req?: Request) {
    const { data: membership } = await this.supabase
      .from('memberships')
      .select('id, role')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!membership) {
      throw new NotFoundException({
        message: 'You are not a member of this classroom',
        error: ErrorCode.CLASSROOM_NOT_MEMBER,
      });
    }

    if (membership.role === 'admin') {
      const { count } = await this.supabase
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('classroom_id', classroomId)
        .eq('role', 'admin');

      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          'You are the only admin of this classroom. Promote another member to admin before leaving.',
        );
      }
    }

    const { error } = await this.supabase.from('memberships').delete().eq('id', membership.id);

    if (error) {
      this.logger.error('Failed to leave classroom', { error, userId, classroomId });
      throw new BadRequestException('Failed to leave this classroom. Please try again.');
    }

    this.events.emit('classroom.left', { classroomId, userId });

    await this.audit.log({
      eventType:  AuditEventType.CLASSROOM_LEFT,
      actorId:    userId,
      targetId:   classroomId,
      targetType: 'classroom',
      metadata:   { role: membership.role },
      req,
    });
  }

  // ── Admin settings ────────────────────────────────────────────────────────

  /**
   * Updates classroom settings. Requires the caller to hold a VERIFIED
   * 'admin' membership in this specific classroom — school-admin personas
   * do not implicitly grant this; SPEC.md §7.2 keeps classroom-admin and
   * school-admin as distinct levels in the hierarchy.
   */
  async updateClassroom(
    classroomId: string,
    actorId: string,
    dto: UpdateClassroomDto,
    req?: Request,
  ) {
    await this.assertClassroomAdmin(actorId, classroomId);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.hasStaffRoom !== undefined) patch.has_staff_room = dto.hasStaffRoom;
    if (dto.hasStudentAlley !== undefined) patch.has_student_alley = dto.hasStudentAlley;
    if (dto.requireVerification !== undefined) patch.require_verification = dto.requireVerification;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No updatable fields were provided');
    }

    const { data: updated, error } = await this.supabase
      .from('classrooms')
      .update(patch)
      .eq('id', classroomId)
      .select()
      .single();

    if (error || !updated) {
      this.logger.error('Failed to update classroom', { error, classroomId, patch });
      throw new BadRequestException('Failed to update this classroom. Please try again.');
    }

    // AuditEventType had no event for "classroom settings changed" — every
    // other one is either creation or membership — so CLASSROOM_SETTINGS_UPDATED
    // was added to @alumini/types to cover it, following the same precedent
    // as AUTH_TOKEN_REFRESHED in the auth module.
    await this.audit.log({
      eventType:  AuditEventType.CLASSROOM_SETTINGS_UPDATED,
      actorId,
      targetId:   classroomId,
      targetType: 'classroom',
      metadata:   { changes: patch },
      req,
    });

    return updated;
  }

  /** Same "verified classroom-level admin only, no school-admin fallback" rule as updateClassroom() — see its own doc comment. */
  private async assertClassroomAdmin(actorId: string, classroomId: string): Promise<void> {
    const { data: membership } = await this.supabase
      .from('memberships')
      .select('role, verification_status')
      .eq('user_id', actorId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!membership || membership.role !== 'admin' || membership.verification_status !== 'verified') {
      throw new ForbiddenException('Only a verified admin of this classroom can do this');
    }
  }

  // ── Cover photo ──────────────────────────────────────────────────────────

  /** See UpdateLogoDto's comment (institution module) on why this takes a Storage URL, not the file itself — same reasoning, same pattern. */
  async updateCover(classroomId: string, actorId: string, coverUrl: string) {
    await this.assertClassroomAdmin(actorId, classroomId);

    const { data, error } = await this.supabase
      .from('classrooms')
      .update({ cover_url: coverUrl })
      .eq('id', classroomId)
      .select('id, coverUrl:cover_url')
      .maybeSingle();

    if (error || !data) {
      this.logger.error('Failed to update classroom cover', { error, classroomId });
      throw new BadRequestException('Failed to update cover photo. Please try again.');
    }

    return { coverUrl: data.coverUrl as string };
  }
}
