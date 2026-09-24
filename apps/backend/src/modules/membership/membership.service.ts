/**
 * MembershipService — roles, channel access rules, and verification-status
 * queries for classroom memberships (SPEC.md §7.2, §7.3, §7.4).
 *
 * SCOPE: the classroom module already owns join/leave (creating and
 * deleting membership rows) — this module does NOT duplicate that. It owns
 * the business logic layered on TOP of an existing membership: changing a
 * member's role, answering "can this user access this channel", and
 * surfacing verification status. It reads/writes the `memberships` table
 * directly for this — the same pragmatic cross-module table-access pattern
 * every module since auth has used (see AuthService's module comment for
 * the original reasoning); `memberships` itself is created by
 * 001_initial_schema.sql and is not "owned" more by classroom than by this
 * module for the purposes this file cares about.
 *
 * CHANNEL ACCESS (SPEC.md §7.3)
 *   classroom      — any VERIFIED member
 *   staff_room     — VERIFIED members with role 'teacher' or 'admin'
 *   student_alley  — VERIFIED members with role 'student'
 * canAccessChannel() answers "may this user fully read+post this channel
 * right now" — a strict boolean. SPEC.md §7.4's "Joined, unverified: Chat
 * (redacted), No post" is a DIFFERENT, softer mode (read-only + redacted
 * content) that applies only to the main 'classroom' channel and is a
 * presentation-layer concern for whichever module actually serves messages
 * (corridor, not yet built) — mirrors how ClassroomService.getMembers()
 * does its own redaction rather than this module doing it for them.
 * canAccessChannel() intentionally does not attempt to express that
 * three-state (full / redacted-read-only / none) matrix — corridor calls
 * this for the "may they truly participate" question, and separately
 * decides its own redacted-preview behaviour for unverified members.
 *
 * ROLE CHANGES / AUDIT
 * AuditEventType only has two buckets for role changes — PROMOTED and
 * DEMOTED — to sort all six possible role transitions into. This module
 * uses a simple total order (student < teacher < admin, see ROLE_RANK
 * below) to classify a change as one or the other. SPEC.md never states
 * this ordering explicitly for classroom-level roles (§7.2's admin
 * hierarchy table is about school/platform admin levels, not
 * student/teacher/admin classroom roles) — documented assumption.
 *
 * CONFIG
 * Pagination for GET /membership/pending reuses appConfig.CLASSROOMS_PAGE_SIZE
 * (it's a list of classrooms, same shape of concern as the filing cabinet
 * view) rather than inventing a new config key for what is fundamentally
 * the same kind of list.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType, ChannelType, MemberRole } from '@alumini/types';
import { getRange } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';

import { ChangeRoleDto } from './dto/change-role.dto';

/** Total order used to classify a role change as promotion vs demotion — see module comment. */
const ROLE_RANK: Record<MemberRole, number> = {
  [MemberRole.STUDENT]: 0,
  [MemberRole.TEACHER]: 1,
  [MemberRole.ADMIN]:   2,
};

/**
 * BUG FIX — "invalid input syntax for type uuid: IN-KOL-KVFORTW-10C-2006".
 * Every route here takes `:classroomId` straight off the URL and used to
 * pass it directly into `.eq('classroom_id', classroomId)` — fine as long
 * as the caller always sends the classroom's internal UUID, which one
 * frontend link didn't (it used the [globalId] route param instead of
 * classroom.id — see classroom/[globalId]/page.tsx's own fix). `memberships
 * .classroom_id` is a UUID column, so a global-ID-shaped string reaches
 * Postgres and fails at the type level with exactly that error. Same
 * detection regex as ClassroomService.getByIdOrGlobalId() — resolves once,
 * cheaply, before any membership query, so this endpoint is robust
 * regardless of what shape the caller sends, not just the one frontend bug
 * that surfaced it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(
    private readonly audit: AuditService,
    appLogger: AppLogger,
  ) {
    this.appLogger = appLogger.setContext('MEMBERSHIP');
    // Service role — bypasses RLS, same pattern as every other module.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  /**
   * Resolves a `:classroomId` URL param to the classroom's internal UUID —
   * see the UUID_RE comment above. Returns null (not a thrown exception) for
   * an unresolvable global ID, so callers with a "no access" contract
   * (canAccessChannel()) can fold it into their existing false/denied
   * result instead of surfacing a raw 404 from what used to be a boolean-
   * returning method.
   */
  private async resolveClassroomId(classroomId: string): Promise<string | null> {
    if (UUID_RE.test(classroomId)) return classroomId;

    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('id')
      .eq('global_id', classroomId)
      .maybeSingle();

    return classroom?.id ?? null;
  }

  // ── Channel access (used by other modules, e.g. corridor) ────────────────

  /**
   * Returns true only if `userId` is a VERIFIED (or, for the classroom/
   * student_alley channels, 'pending_auto' — see 011_pending_auto_status.sql)
   * member of `classroomId` whose role is allowed to fully read+post
   * `channel` (SPEC.md §7.3). Non-members and rejected/plain-pending members
   * always get false here, regardless of channel — see the module-level
   * comment for why "unverified but allowed a redacted peek at the
   * classroom channel" is NOT expressed by this method.
   *
   * staff_room stays verified-only unconditionally: pending_auto exists to
   * unblock a brand-new classroom's early joiners, not to grant early
   * access to the teacher-only room.
   */
  async canAccessChannel(userId: string, classroomId: string, channel: ChannelType): Promise<boolean> {
    this.appLogger.debug('[MEMBERSHIP:canAccess] entry', { userId, classroomId, channel });
    const resolvedId = await this.resolveClassroomId(classroomId);
    if (!resolvedId) return false;
    classroomId = resolvedId;

    const { data: membership } = await this.supabase
      .from('memberships')
      .select('role, verification_status')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    this.appLogger.debug('[MEMBERSHIP:canAccess] membership lookup', {
      found: !!membership,
      role: membership?.role,
      verificationStatus: membership?.verification_status,
    });

    if (!membership) return false;

    const isVerified = membership.verification_status === 'verified';
    const isEarlyMember = membership.verification_status === 'pending_auto';

    let result: boolean;
    switch (channel) {
      case ChannelType.CLASSROOM:
        result = isVerified || isEarlyMember; // any full/early member, any role
        break;
      case ChannelType.STAFF_ROOM:
        result = isVerified && (membership.role === MemberRole.TEACHER || membership.role === MemberRole.ADMIN);
        break;
      case ChannelType.STUDENT_ALLEY:
        result = (isVerified || isEarlyMember) && membership.role === MemberRole.STUDENT;
        break;
      default:
        result = false;
    }

    this.appLogger.debug('[MEMBERSHIP:canAccess] result', { userId, classroomId, channel, result });
    return result;
  }

  // ── Membership lookup ────────────────────────────────────────────────────

  /** The caller's own membership details for one classroom. */
  async getMembership(userId: string, classroomId: string) {
    this.appLogger.debug('[MEMBERSHIP:get] entry', { userId, classroomId });
    const resolvedId = await this.resolveClassroomId(classroomId);
    if (!resolvedId) {
      throw new NotFoundException('Classroom not found');
    }
    classroomId = resolvedId;

    const { data, error } = await this.supabase
      .from('memberships')
      .select('id, classroom_id, role, verification_status, verification_method, verified_at, joined_at')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    this.appLogger.debug('[MEMBERSHIP:get] result', { found: !!data, error: error?.message, code: error?.code });

    if (error) {
      this.appLogger.error('[MEMBERSHIP:get] failed', {
        userId,
        classroomId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to fetch membership');
    }
    if (!data) {
      this.appLogger.warn('[MEMBERSHIP:get] not found', { userId, classroomId });
      throw new NotFoundException('You are not a member of this classroom');
    }

    return data;
  }

  /** Thin projection of getMembership() for the verification-status-only view. */
  async getVerificationStatus(userId: string, classroomId: string) {
    const membership = await this.getMembership(userId, classroomId);

    return {
      classroomId,
      verificationStatus: membership.verification_status,
      verificationMethod: membership.verification_method,
      verifiedAt: membership.verified_at,
    };
  }

  /**
   * All classrooms where the caller's membership is still 'pending' —
   * powers the "verify now" nudge on the home screen.
   */
  async getPendingVerifications(userId: string, page = 0) {
    this.appLogger.debug('[MEMBERSHIP:pending] entry', { userId, page });
    const { from, to } = getRange(page, appConfig.CLASSROOMS_PAGE_SIZE);

    const { data, error } = await this.supabase
      .from('memberships')
      .select(
        'classroom_id, role, joined_at, ' +
          'classroom:classrooms(id, global_id, name, institution:institutions(id, name))',
      )
      .eq('user_id', userId)
      .eq('verification_status', 'pending')
      .order('joined_at', { ascending: true })
      .range(from, to);

    this.appLogger.debug('[MEMBERSHIP:pending] result', { count: data?.length, error: error?.message });

    if (error) {
      this.appLogger.error('[MEMBERSHIP:pending] failed', {
        userId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to fetch pending verifications');
    }

    return data ?? [];
  }

  // ── Role management (SPEC.md §7.2) ───────────────────────────────────────

  /**
   * Promotes or demotes a member's role. Only a verified classroom admin
   * may call this, and the classroom's last admin can never be demoted
   * (SPEC.md — "cannot demote the last admin").
   */
  async changeRole(
    actorId: string,
    classroomId: string,
    dto: ChangeRoleDto,
    req?: Request,
  ) {
    this.appLogger.debug('[MEMBERSHIP:changeRole] entry', { actorId, classroomId, targetUserId: dto.targetUserId, role: dto.role });
    const resolvedId = await this.resolveClassroomId(classroomId);
    if (!resolvedId) {
      throw new NotFoundException('Classroom not found');
    }
    classroomId = resolvedId;

    const { data: actorMembership } = await this.supabase
      .from('memberships')
      .select('role, verification_status, is_creator')
      .eq('user_id', actorId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (
      !actorMembership ||
      (actorMembership.role !== MemberRole.ADMIN && !actorMembership.is_creator) ||
      actorMembership.verification_status !== 'verified'
    ) {
      throw new ForbiddenException('Only a verified admin of this classroom can change member roles');
    }

    const { data: targetMembership } = await this.supabase
      .from('memberships')
      .select('id, role')
      .eq('user_id', dto.targetUserId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!targetMembership) {
      throw new NotFoundException('This user is not a member of this classroom');
    }

    const fromRole = targetMembership.role as MemberRole;
    const toRole = dto.role;

    if (fromRole === toRole) {
      // Idempotent — nothing changed, nothing to audit. Same pattern as
      // IdentityService.switchPersona()'s no-op branch.
      return targetMembership;
    }

    if (fromRole === MemberRole.ADMIN && toRole !== MemberRole.ADMIN) {
      const { count } = await this.supabase
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('classroom_id', classroomId)
        .eq('role', MemberRole.ADMIN);

      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          'Cannot demote the only admin of this classroom. Promote another member to admin first.',
        );
      }
    }

    const { data: updated, error } = await this.supabase
      .from('memberships')
      .update({ role: toRole })
      .eq('id', targetMembership.id)
      .select()
      .single();

    this.appLogger.debug('[MEMBERSHIP:changeRole] update result', { success: !error && !!updated });

    if (error || !updated) {
      this.appLogger.error('[MEMBERSHIP:changeRole] failed', {
        classroomId,
        error: error?.message,
        code: error?.code,
        hint: error?.hint,
        details: error?.details,
      });
      throw new BadRequestException('Failed to change this member’s role. Please try again.');
    }

    const eventType =
      ROLE_RANK[toRole] > ROLE_RANK[fromRole]
        ? AuditEventType.CLASSROOM_ADMIN_PROMOTED
        : AuditEventType.CLASSROOM_ADMIN_DEMOTED;

    await this.audit.log({
      eventType,
      actorId,
      targetId: dto.targetUserId,
      targetType: 'membership',
      metadata: { classroom_id: classroomId, from_role: fromRole, to_role: toRole },
      req,
    });

    this.appLogger.info('[MEMBERSHIP:changeRole] success', { actorId, classroomId, targetUserId: dto.targetUserId, fromRole, toRole });
    return updated;
  }
}
