/**
 * InstitutionService — institution search, the institution-claim flow, and
 * co-admin management (SPEC.md §6.2, §11).
 *
 * OWNERSHIP / CROSS-MODULE TABLE ACCESS
 * `institutions` is this module's own table. `personas` is nominally the
 * identity module's (SPEC.md §15.3), but this module reads and writes it
 * directly for claim/admin state — the same pragmatic pattern the auth
 * module already established (AuthService reads/writes `profiles` and
 * reads `personas` for its own concerns despite neither being "its" table).
 * A stricter design would route persona mutations through IdentityService
 * or an event, but claim/invite/remove/transfer all need to read back the
 * row they just wrote in the same request to decide what happens next
 * (e.g. "is this the first claim?"), which an async event can't do
 * transactionally. Documented here rather than silently deviating.
 *
 * TWO DIFFERENT "BECOMING AN ADMIN" FLOWS (do not conflate them)
 * 1. submitClaim() — SPEC.md §11.1. Claiming an *unclaimed* institution.
 *    Always lands pending_approval and always needs a platform-admin
 *    (Alumini ops) to approve it via approveClaim()/rejectClaim() — SPEC.md
 *    §3.4 makes platform-admin review "service-role only... never exposed
 *    to users", so those two methods are intentionally NOT wired to any
 *    controller route in this module. They're still fully implemented and
 *    tested service methods — a future internal ops tool calls them
 *    directly. The approved claimant becomes the Primary Admin.
 * 2. inviteAdmin() / acceptInvite() — SPEC.md §11.3. Once an institution
 *    already has a Primary Admin, THEY invite co-admins by email. No
 *    platform-admin review — accepting the magic link activates the
 *    persona immediately. Primary Admin only, MFA re-challenge required
 *    (enforced by MfaChallengeGuard at the controller, not here).
 *
 * AUDIT
 * INSTITUTION_CLAIMED (submit), INSTITUTION_CLAIM_APPROVED/REJECTED
 * (ops review), INSTITUTION_ADMIN_INVITED/ACCEPTED/REMOVED/TRANSFERRED —
 * every one written via AuditService, per SPEC.md §11 and §14.2.
 *
 * CONFIG
 * appConfig.INSTITUTION_MAX_ADMINS (admin cap) and
 * appConfig.ADMIN_INVITE_EXPIRY_HOURS (magic-link lifetime) — never hardcoded.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType, ErrorCode, MemberRole, PersonaType } from '@alumini/types';
import { isExpired, getRange } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';

import { SearchInstitutionsDto } from './dto/search-institutions.dto';
import { RequestInstitutionDto } from './dto/request-institution.dto';
import { ClaimInstitutionDto } from './dto/claim-institution.dto';
import { RejectClaimDto } from './dto/reject-claim.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { RemoveAdminDto } from './dto/remove-admin.dto';
import { TransferPrimaryAdminDto } from './dto/transfer-admin.dto';
import { RequestAdminAccessDto } from './dto/request-admin-access.dto';
import { ReviewAdminRequestDto } from './dto/review-admin-request.dto';
import { PlatformInviteAdminDto } from './dto/platform-invite-admin.dto';
import { UpdateInstitutionProfileDto } from './dto/update-institution-profile.dto';
import { RequestSubscriptionUpgradeDto } from './dto/request-subscription-upgrade.dto';
import { UpdateInstitutionSubscriptionDto } from './dto/update-institution-subscription.dto';
import { SetClassroomAdminRoleDto } from './dto/set-classroom-admin-role.dto';
import { CreateClassroomForInstitutionDto } from './dto/create-classroom-for-institution.dto';
import { UpdateClassroomForInstitutionDto } from './dto/update-classroom-for-institution.dto';
import { SendInstitutionAnnouncementDto } from './dto/send-institution-announcement.dto';
import { ListInstitutionMembersDto } from './dto/list-institution-members.dto';
import { ListInstitutionVerificationsDto } from './dto/list-institution-verifications.dto';
import { ClassroomService } from '../classroom/classroom.service';

/** Payload of the signed co-admin invitation JWT ("magic link" token). */
interface AdminInviteTokenPayload {
  inviteId: string;
  institutionId: string;
  email: string;
  purpose: 'admin_invite';
}

@Injectable()
export class InstitutionService {
  private readonly logger = new Logger(InstitutionService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(
    private readonly audit: AuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly jwtService: JwtService,
    private readonly classroomService: ClassroomService,
    appLogger: AppLogger,
  ) {
    this.appLogger = appLogger.setContext('INSTITUTION');
    // Service role — bypasses RLS, same pattern as every other module.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /**
   * Institution autocomplete (SPEC.md §5.1/§5.2 step 4, §7.1). Moved from
   * ClassroomService — this is the correct module for it (institution/ owns
   * "the institution database" per SPEC.md §15.3).
   */
  async searchInstitutions(dto: SearchInstitutionsDto) {
    this.appLogger.debug('[INSTITUTION:search] entry', { query: dto.q, countryCode: dto.countryCode, limit: 10 });
    let queryBuilder = this.supabase
      .from('institutions')
      .select('id, name, slug, type, city_code, country_code, email_domain')
      .ilike('name', `%${dto.q}%`)
      .limit(10);

    if (dto.countryCode) {
      queryBuilder = queryBuilder.eq('country_code', dto.countryCode.toUpperCase());
    }

    const { data, error } = await queryBuilder;

    this.appLogger.debug('[INSTITUTION:search] result', { count: data?.length, error: error?.message });

    if (error) {
      this.appLogger.error('[INSTITUTION:search] failed', {
        query: dto.q,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      return [];
    }

    return data ?? [];
  }

  // ── Institution requests (TASK 05 — proposing a NEW institution) ─────────
  //
  // Different from the claim flow below: submitClaim() is for claiming
  // administration of an institution that already exists in `institutions`.
  // requestInstitution() is upstream of that — for an institution that
  // doesn't exist in the database at all yet, so there's nothing to search
  // for or claim until a platform admin reviews and creates it.

  /**
   * Submits a request for a new institution. If an institution with a
   * similar name already exists, returns its details via a 409 instead of
   * creating a duplicate request — same "offer the existing thing instead
   * of creating a duplicate" pattern as ClassroomService.createClassroom().
   */
  async requestInstitution(userId: string, dto: RequestInstitutionDto, req?: Request) {
    this.appLogger.debug('[INSTITUTION:request] entry', { name: dto.name, type: dto.type, city: dto.city, userId });

    const { data: existing } = await this.supabase
      .from('institutions')
      .select('id, name, slug, type, city_code, country_code')
      .ilike('name', `%${dto.name}%`)
      .maybeSingle();

    this.appLogger.debug('[INSTITUTION:request] duplicate check', { duplicateFound: !!existing, existingName: existing?.name });

    if (existing) {
      this.appLogger.warn('[INSTITUTION:request] duplicate', { name: dto.name, existingId: existing.id });
      // FIX 3F: include enough of the existing institution's own shape
      // (type/cityCode/countryCode, not just id/name/slug) so the frontend
      // can build a complete Institution object straight from this 409
      // body and select it directly — no follow-up search call needed
      // (that follow-up call is what used to silently break "Use this
      // institution"; see AllExceptionsFilter's own fix for why these
      // extra fields previously never reached the client at all).
      throw new ConflictException({
        message: `A similar institution already exists: ${existing.name}.`,
        error: ErrorCode.INSTITUTION_REQUEST_DUPLICATE,
        existingInstitutionId: existing.id,
        existingInstitutionName: existing.name,
        existingInstitutionSlug: existing.slug,
        existingInstitutionType: existing.type,
        existingInstitutionCityCode: existing.city_code,
        existingInstitutionCountryCode: existing.country_code,
      });
    }

    const { data: request, error } = await this.supabase
      .from('institution_requests')
      .insert({
        requested_by: userId,
        name: dto.name,
        type: dto.type,
        city: dto.city ?? null,
        city_code: dto.cityCode ?? null,
        country_code: dto.countryCode,
        website_url: dto.websiteUrl ?? null,
        email_domain: dto.emailDomain ?? null,
        requester_relationship: dto.requesterRelationship,
        notes: dto.notes ?? null,
      })
      .select()
      .single();

    this.appLogger.debug('[INSTITUTION:request] insert result', { success: !error && !!request, requestId: request?.id });

    if (error || !request) {
      this.appLogger.error('[INSTITUTION:request] failed', {
        userId,
        error: error?.message,
        code: error?.code,
        hint: error?.hint,
        details: error?.details,
      });
      throw new BadRequestException('Failed to submit this request. Please try again.');
    }

    this.logger.log(`[INSTITUTION-REQUEST] ${dto.name} (${dto.type}) ${dto.city ?? ''} by ${userId}`);
    this.appLogger.info('[INSTITUTION:request] submitted', { requestId: request.id, name: dto.name, userId });

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_REQUEST_SUBMITTED,
      actorId: userId,
      targetId: request.id,
      targetType: 'institution_request',
      metadata: { name: dto.name, type: dto.type },
      req,
    });

    return { message: 'Request submitted', requestId: request.id };
  }

  /** All institution requests the caller has submitted, newest first. */
  async getMyInstitutionRequests(userId: string) {
    const { data, error } = await this.supabase
      .from('institution_requests')
      .select('id, name, type, city, country_code, status, rejection_reason, created_at')
      .eq('requested_by', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to load institution requests', { error, userId });
      throw new BadRequestException('Failed to load your requests');
    }

    return data ?? [];
  }

  // ── Claim flow (SPEC.md §11.1) ───────────────────────────────────────────

  /**
   * Submits a claim on an unclaimed institution. Always creates a
   * pending_approval school_admin persona — SPEC.md §11.1: "Cannot be
   * self-serve." Approval is a separate, platform-admin-only step (see
   * approveClaim()).
   */
  async submitClaim(
    userId: string,
    institutionId: string,
    dto: ClaimInstitutionDto,
    req?: Request,
  ) {
    const { data: institution } = await this.supabase
      .from('institutions')
      .select('id, is_claimed')
      .eq('id', institutionId)
      .maybeSingle();

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    if (institution.is_claimed) {
      // Once claimed, the ONLY way to become an admin is a Primary Admin
      // invite (inviteAdmin()/acceptInvite()) — SPEC.md §11.1: "Subsequent
      // admins = invited by Primary Admin. Can be self-serve after
      // institution is claimed" (i.e. self-serve *acceptance* of an
      // invite, not a raw unsolicited claim).
      throw new ConflictException(
        'This institution has already been claimed. Ask the primary admin for a co-admin invite instead.',
      );
    }

    // Friendlier than the raw UNIQUE(user_id, type, institution_id)
    // constraint violation — same pattern used throughout this codebase
    // (ClassroomService's global_id check, IdentityService.addPersona()).
    const { data: existing } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', userId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .eq('institution_id', institutionId)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('You already have a pending or active admin claim at this institution');
    }

    // is_primary_admin is deliberately NOT set here. "First claim = Primary
    // Admin" is about which claim gets APPROVED first for a still-unclaimed
    // institution (two people could race to submit a claim on the same
    // institution before either is reviewed) — approveClaim() is what
    // actually grants primary status, at the moment it also flips
    // institutions.is_claimed. A rejected claim never becomes "primary"
    // anything.
    const { data: persona, error: insertError } = await this.supabase
      .from('personas')
      .insert({
        user_id: userId,
        type: PersonaType.SCHOOL_ADMIN,
        institution_id: institutionId,
        status: 'pending_approval',
        is_primary_admin: false,
      })
      .select()
      .single();

    if (insertError || !persona) {
      this.logger.error('Failed to create claim', { error: insertError, userId, institutionId });
      throw new ConflictException('This claim could not be created. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_CLAIMED,
      actorId: userId,
      targetId: institutionId,
      targetType: 'institution',
      metadata: { persona_id: persona.id, justification: dto.justification ?? null },
      req,
    });

    // Hand off to the platform-admin ops queue/notification — a module
    // this codebase hasn't built yet (mirrors VerificationService's
    // event-emission pattern for cross-module hand-off, e.g.
    // 'verification.document.submitted').
    this.eventEmitter.emit('institution.claim.submitted', {
      institutionId,
      userId,
      personaId: persona.id,
    });

    return persona;
  }

  /**
   * TASKS_11 TASK 01 — "request institution admin access", reached from
   * the new /institution-admin/request page. Unlike submitClaim() above,
   * this is allowed even when the institution is ALREADY claimed — the
   * existing design says the only way to become a co-admin of a claimed
   * institution is a Primary Admin invite (SPEC.md §11.3), but TASK 01's
   * product requirement is that a platform admin (not just the Primary
   * Admin) can also grant co-admin access directly, e.g. when the Primary
   * Admin is unresponsive. Same personas insert either way — only the
   * is_claimed branch in approveClaim() below decides whether the
   * eventual approval grants Primary Admin or plain co-admin status.
   */
  async requestAdminAccess(userId: string, dto: RequestAdminAccessDto, req?: Request) {
    this.appLogger.debug('[INSTITUTION:request-access] entry', { userId, institutionId: dto.institutionId, role: dto.role });

    const { data: institution } = await this.supabase
      .from('institutions')
      .select('id, name')
      .eq('id', dto.institutionId)
      .maybeSingle();

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    const { data: existing } = await this.supabase
      .from('personas')
      .select('id, status')
      .eq('user_id', userId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .eq('institution_id', dto.institutionId)
      .maybeSingle();

    if (existing) {
      throw new ConflictException(
        existing.status === 'active'
          ? 'You are already an admin at this institution'
          : 'You already have a pending admin request at this institution',
      );
    }

    const { data: persona, error: insertError } = await this.supabase
      .from('personas')
      .insert({
        user_id: userId,
        type: PersonaType.SCHOOL_ADMIN,
        institution_id: dto.institutionId,
        status: 'pending_approval',
        is_primary_admin: false,
        requested_role: dto.role,
        requested_message: dto.message ?? null,
      })
      .select()
      .single();

    if (insertError || !persona) {
      this.appLogger.error('[INSTITUTION:request-access] failed', {
        userId,
        institutionId: dto.institutionId,
        error: insertError?.message,
        code: insertError?.code,
        hint: insertError?.hint,
        details: insertError?.details,
      });
      throw new ConflictException('This request could not be created. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_CLAIMED,
      actorId: userId,
      targetId: dto.institutionId,
      targetType: 'institution',
      metadata: { persona_id: persona.id, requested_role: dto.role, message: dto.message ?? null },
      req,
    });

    this.appLogger.info('[INSTITUTION:request-access] submitted', { userId, institutionId: dto.institutionId });

    this.eventEmitter.emit('institution.claim.submitted', {
      institutionId: dto.institutionId,
      institutionName: institution.name,
      userId,
      personaId: persona.id,
      role: dto.role,
      fullName: dto.fullName,
    });

    return { message: 'Request submitted. We will review shortly.' };
  }

  /**
   * TASKS_11 TASK 01 — platform-admin review queue for pending
   * school_admin requests (both submitClaim() and requestAdminAccess()
   * land here — they're the same persona row shape).
   */
  async listAdminRequests(approverId: string, status?: string) {
    await this.assertPlatformAdmin(approverId);

    let query = this.supabase
      .from('personas')
      .select(
        'id, user_id, institution_id, status, is_primary_admin, requested_role, requested_message, created_at, ' +
          'profile:profiles(id, full_name, avatar_url, email), ' +
          'institution:institutions(id, name, type, city, country_code)',
      )
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .order('created_at', { ascending: false });

    if (status) {
      // 'invited' has no persona row (it's an institution_admin_invites
      // row instead) — map it separately below rather than filtering it
      // out of this query silently.
      if (status !== 'invited') {
        query = query.eq('status', status === 'approved' ? 'active' : status === 'rejected' ? 'suspended' : status);
      }
    }

    const { data, error } = await query;

    if (error) {
      this.appLogger.error('[INSTITUTION:list-requests] failed', { error: error.message, code: error.code });
      throw new BadRequestException('Failed to load requests');
    }

    if (status === 'invited') {
      const { data: invites } = await this.supabase
        .from('institution_admin_invites')
        .select('id, institution_id, email, invited_by, expires_at, created_at')
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString());
      return { requests: [], invites: invites ?? [] };
    }

    return { requests: data ?? [], invites: [] };
  }

  /**
   * Approves a pending claim. SPEC.md §3.4: platform-admin review is
   * "Access controlled via Supabase service role — never exposed to
   * users" — there is intentionally no public controller route for this.
   * A future internal ops tool/script calls it directly (service-role
   * context), passing whatever identifies the reviewing platform-admin
   * operator for the audit log (`approverId` — this codebase has no
   * platform-admin persona type to authenticate against yet).
   */
  async approveClaim(approverId: string, personaId: string, req?: Request) {
    this.appLogger.debug('[INSTITUTION:approve] entry', { requestId: personaId, adminId: approverId });
    await this.assertPlatformAdmin(approverId);
    const persona = await this.getPendingClaim(personaId);

    const { data: institution } = await this.supabase
      .from('institutions')
      .select('id, is_claimed')
      .eq('id', persona.institution_id)
      .single();

    // TASKS_11 TASK 01 — branches instead of always rejecting an
    // already-claimed institution: requestAdminAccess() (unlike
    // submitClaim()) allows a request against an already-claimed
    // institution too, so an approval here can mean either "you're the
    // first/new Primary Admin" (still unclaimed) or "you're a co-admin"
    // (already claimed by someone else). Only the unclaimed case touches
    // `institutions` at all.
    const becomesPrimary = !institution?.is_claimed;
    const now = new Date().toISOString();

    this.appLogger.debug('[INSTITUTION:approve] activating', { institutionId: persona.institution_id, userId: persona.user_id, becomesPrimary });

    const { error: personaError } = await this.supabase
      .from('personas')
      .update({ status: 'active', is_primary_admin: becomesPrimary })
      .eq('id', personaId);

    let institutionError = null;
    if (becomesPrimary) {
      const result = await this.supabase
        .from('institutions')
        .update({ is_claimed: true, claimed_by: persona.user_id, claimed_at: now })
        .eq('id', persona.institution_id);
      institutionError = result.error;
    }

    if (personaError || institutionError) {
      this.appLogger.error('[INSTITUTION:approve] failed', {
        error: personaError?.message ?? institutionError?.message,
        code: personaError?.code ?? institutionError?.code,
        hint: personaError?.hint ?? institutionError?.hint,
        details: personaError?.details ?? institutionError?.details,
        personaId,
      });
      throw new BadRequestException('Failed to approve this claim. Please try again.');
    }

    this.appLogger.info('[INSTITUTION:approve] success', { institutionId: persona.institution_id, userId: persona.user_id, becomesPrimary });
    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_CLAIM_APPROVED,
      actorId: approverId,
      targetId: persona.institution_id,
      targetType: 'institution',
      metadata: { persona_id: personaId, new_primary_admin: becomesPrimary ? persona.user_id : null, co_admin: !becomesPrimary ? persona.user_id : null },
      req,
    });

    this.eventEmitter.emit('institution.claim.approved', {
      institutionId: persona.institution_id,
      userId: persona.user_id,
    });

    return { institutionId: persona.institution_id, userId: persona.user_id, isPrimaryAdmin: becomesPrimary };
  }

  /** Rejects a pending claim/request. TASKS_11 TASK 01 — now platform-admin gated (see approveClaim()'s matching change). */
  async rejectClaim(approverId: string, personaId: string, dto: RejectClaimDto, req?: Request) {
    this.appLogger.debug('[INSTITUTION:reject] entry', { requestId: personaId, adminId: approverId });
    await this.assertPlatformAdmin(approverId);
    const persona = await this.getPendingClaim(personaId);

    // Rejected claims are suspended, not deleted — personas has no
    // 'rejected' status in its CHECK constraint (001_initial_schema.sql
    // only allows active/pending_approval/suspended), and this codebase
    // never hard-deletes personas anywhere (same "preserve the audit
    // trail" rule removeAdmin() below follows).
    const { error } = await this.supabase
      .from('personas')
      .update({ status: 'suspended' })
      .eq('id', personaId);

    if (error) {
      this.appLogger.error('[INSTITUTION:reject] failed', {
        personaId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to reject this claim. Please try again.');
    }

    this.appLogger.info('[INSTITUTION:reject] rejected', { requestId: personaId, reason: dto.reason });
    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_CLAIM_REJECTED,
      actorId: approverId,
      targetId: persona.institution_id,
      targetType: 'institution',
      metadata: { persona_id: personaId, user_id: persona.user_id, reason: dto.reason },
      req,
    });

    this.eventEmitter.emit('institution.claim.rejected', {
      institutionId: persona.institution_id,
      userId: persona.user_id,
      reason: dto.reason,
    });
  }

  private async getPendingClaim(personaId: string) {
    const { data: persona } = await this.supabase
      .from('personas')
      .select('id, user_id, institution_id, type, status')
      .eq('id', personaId)
      .maybeSingle();

    if (!persona || persona.type !== PersonaType.SCHOOL_ADMIN) {
      throw new NotFoundException('Claim not found');
    }
    if (persona.status !== 'pending_approval') {
      throw new ConflictException(`This claim has already been ${persona.status === 'active' ? 'approved' : 'rejected'}`);
    }

    return persona;
  }

  // ── Co-admin roster (SPEC.md §11) ────────────────────────────────────────

  /**
   * Lists active/pending admins and outstanding invites for an institution.
   * ASSUMPTION: readable by ANY active admin of the institution, not just
   * the primary. SPEC.md §6.2 restricts *mutating* actions ("Only primary
   * admin can invite, remove, or transfer") to the primary, but doesn't
   * say the same about viewing the roster — co-admins reasonably need to
   * see who else administers their own institution. No MFA re-challenge
   * either, matching this codebase's general pattern of reserving that for
   * state-changing actions.
   */
  async listAdmins(callerId: string, institutionId: string) {
    await this.assertActiveAdmin(callerId, institutionId);

    // TASKS_11 TASK 05 — profile.email added so AdminsTab can show it
    // (previously only pending invites carried an email, per this
    // method's own prior comment — now admin rows do too).
    const { data: admins, error } = await this.supabase
      .from('personas')
      .select(
        'id, user_id, status, is_primary_admin, created_at, ' +
          'profile:profiles(id, full_name, avatar_url, email)',
      )
      .eq('institution_id', institutionId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .in('status', ['active', 'pending_approval'])
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to list admins', { error, institutionId });
      throw new BadRequestException('Failed to load admins');
    }

    const { data: invites } = await this.supabase
      .from('institution_admin_invites')
      .select('id, email, invited_by, expires_at, created_at')
      .eq('institution_id', institutionId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString());

    return { admins: admins ?? [], pendingInvites: invites ?? [] };
  }

  // ── Co-admin invitation flow (SPEC.md §11.3) ─────────────────────────────

  async inviteAdmin(actorId: string, institutionId: string, dto: InviteAdminDto, req?: Request, expiresInDays?: number) {
    // TASKS_11 TASK 01 — a platform admin can also invite directly
    // (bootstraps the institution's first admin, or adds a co-admin on
    // the Primary Admin's behalf), not just the institution's own Primary
    // Admin. See PlatformInviteAdminController route for the platform-admin
    // call site; the existing co-admin-inviting-a-co-admin call site is
    // unaffected since assertPrimaryAdmin() still runs for everyone else.
    if (!(await this.isPlatformAdmin(actorId))) {
      await this.assertPrimaryAdmin(actorId, institutionId);
    }
    await this.assertAdminCapNotReached(institutionId);

    const expiryHours = expiresInDays ? expiresInDays * 24 : appConfig.ADMIN_INVITE_EXPIRY_HOURS;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    const { data: invite, error } = await this.supabase
      .from('institution_admin_invites')
      .insert({
        institution_id: institutionId,
        email: dto.email,
        invited_by: actorId,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error || !invite) {
      this.logger.error('Failed to create admin invite', { error, institutionId, email: dto.email });
      throw new BadRequestException('Failed to create the invitation. Please try again.');
    }

    const payload: AdminInviteTokenPayload = {
      inviteId: invite.id,
      institutionId,
      email: dto.email,
      purpose: 'admin_invite',
    };
    const token = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: `${expiryHours}h`,
    });

    // Actual email delivery (Resend credentials/templates, the magic-link
    // URL shape) belongs to the notification module — this module only
    // creates the invite record and the signed token, then hands off.
    // Same pattern as AuthService.initiateSmsChallenge().
    this.eventEmitter.emit('institution.admin.invited', {
      institutionId,
      email: dto.email,
      invitedBy: actorId,
      token,
      expiresAt,
    });

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_ADMIN_INVITED,
      actorId,
      targetId: institutionId,
      targetType: 'institution',
      metadata: { invite_id: invite.id, email: dto.email },
      req,
    });

    return { inviteId: invite.id, email: dto.email, expiresAt };
  }

  /**
   * Accepts a co-admin invitation via the magic link. Deliberately public
   * (no JwtAuthGuard) — the signed token IS the credential, matching how
   * magic links work everywhere else; the caller may not have an active
   * session when they click the email link.
   *
   * ASSUMPTION: the invitee must already have an account under the
   * invited email address. This module doesn't create accounts (that's
   * POST /auth/signup's job) — if no matching profile exists, the caller
   * is told to sign up first and reopen the link.
   */
  /**
   * TASKS_11 TASK 01 — read-only lookup so the accept-invite page can show
   * "You've been invited to manage [Institution]" BEFORE the user commits,
   * without consuming the invite the way acceptInvite() does.
   */
  async previewInvite(token: string): Promise<{ institutionId: string; institutionName: string | null; email: string }> {
    const payload = await this.verifyAdminInviteToken(token);

    const { data: invite } = await this.supabase
      .from('institution_admin_invites')
      .select('institution_id, email, accepted_at, expires_at')
      .eq('id', payload.inviteId)
      .maybeSingle();

    if (!invite) {
      throw new NotFoundException('Invitation not found');
    }
    if (invite.accepted_at) {
      throw new ConflictException('This invitation has already been used');
    }
    if (isExpired(invite.expires_at)) {
      throw new UnauthorizedException('This invitation has expired');
    }

    const { data: institution } = await this.supabase
      .from('institutions')
      .select('name')
      .eq('id', invite.institution_id)
      .maybeSingle();

    return { institutionId: invite.institution_id, institutionName: institution?.name ?? null, email: invite.email };
  }

  private async verifyAdminInviteToken(token: string): Promise<AdminInviteTokenPayload> {
    let payload: AdminInviteTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AdminInviteTokenPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired invitation link');
    }
    if (payload.purpose !== 'admin_invite') {
      throw new UnauthorizedException('Not an admin invitation token');
    }
    return payload;
  }

  async acceptInvite(token: string, req?: Request) {
    const payload = await this.verifyAdminInviteToken(token);

    const { data: invite } = await this.supabase
      .from('institution_admin_invites')
      .select('id, institution_id, email, accepted_at, expires_at')
      .eq('id', payload.inviteId)
      .maybeSingle();

    if (!invite) {
      throw new NotFoundException('Invitation not found');
    }
    if (invite.accepted_at) {
      throw new ConflictException('This invitation has already been used');
    }
    if (isExpired(invite.expires_at)) {
      throw new UnauthorizedException('This invitation has expired');
    }

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', invite.email)
      .maybeSingle();

    if (!profile) {
      throw new NotFoundException(
        `No account exists for ${invite.email} yet. Sign up with this email first, then reopen the invitation link.`,
      );
    }

    const { data: existing } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', profile.id)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .eq('institution_id', invite.institution_id)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('You are already an admin at this institution');
    }

    // Co-admins go active immediately — only the institution's FIRST claim
    // (ownership itself) needs platform-admin review (SPEC.md §11.1 vs §11.3).
    //
    // TASKS_11 TASK 01 — a platform-admin-issued invite (PlatformInviteAdminDto,
    // see inviteAdmin()'s isPlatformAdmin() bypass above) can target an
    // institution with no Primary Admin yet, to bootstrap one directly
    // instead of going through submitClaim()/approveClaim(). Mirrors
    // approveClaim()'s own is_claimed branch: unclaimed at accept time →
    // this invitee becomes Primary Admin and the institution is marked
    // claimed; already claimed → plain co-admin, same as before.
    const { data: institution } = await this.supabase
      .from('institutions')
      .select('id, is_claimed')
      .eq('id', invite.institution_id)
      .maybeSingle();
    const becomesPrimary = !institution?.is_claimed;

    const { data: persona, error: insertError } = await this.supabase
      .from('personas')
      .insert({
        user_id: profile.id,
        type: PersonaType.SCHOOL_ADMIN,
        institution_id: invite.institution_id,
        status: 'active',
        is_primary_admin: becomesPrimary,
      })
      .select()
      .single();

    if (insertError || !persona) {
      this.logger.error('Failed to create co-admin persona', { error: insertError, invite });
      throw new ConflictException('This invitation could not be completed. Please try again.');
    }

    if (becomesPrimary) {
      await this.supabase
        .from('institutions')
        .update({ is_claimed: true, claimed_by: profile.id, claimed_at: new Date().toISOString() })
        .eq('id', invite.institution_id);
    }

    await this.supabase
      .from('institution_admin_invites')
      .update({ accepted_at: new Date().toISOString(), accepted_by: profile.id })
      .eq('id', invite.id);

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_ADMIN_ACCEPTED,
      actorId: profile.id,
      targetId: invite.institution_id,
      targetType: 'institution',
      metadata: { invite_id: invite.id, persona_id: persona.id },
      req,
    });

    const { data: institutionRow } = await this.supabase
      .from('institutions')
      .select('name')
      .eq('id', invite.institution_id)
      .maybeSingle();

    return { ...persona, institutionId: invite.institution_id, institutionName: institutionRow?.name ?? null };
  }

  // ── Co-admin removal (SPEC.md §11, §6.2) ─────────────────────────────────

  async removeAdmin(
    actorId: string,
    institutionId: string,
    targetUserId: string,
    dto: RemoveAdminDto,
    req?: Request,
  ) {
    await this.assertPrimaryAdmin(actorId, institutionId);

    if (actorId === targetUserId) {
      throw new ForbiddenException(
        'The primary admin cannot remove themselves. Transfer the primary role first.',
      );
    }

    const { data: target } = await this.supabase
      .from('personas')
      .select('id, status, is_primary_admin')
      .eq('user_id', targetUserId)
      .eq('institution_id', institutionId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .maybeSingle();

    if (!target || target.status !== 'active') {
      throw new NotFoundException('This user is not an active admin at this institution');
    }

    if (target.is_primary_admin) {
      // Defence in depth — is_primary_admin should always coincide with
      // actorId === targetUserId given only one persona can hold it per
      // institution, but this guards against that invariant ever drifting.
      throw new ForbiddenException('The primary admin cannot be removed. Transfer the primary role first.');
    }

    // Suspended, not deleted — preserves the audit trail (same rule as
    // rejectClaim() above).
    const { error } = await this.supabase
      .from('personas')
      .update({ status: 'suspended' })
      .eq('id', target.id);

    if (error) {
      this.logger.error('Failed to remove admin', { error, institutionId, targetUserId });
      throw new BadRequestException('Failed to remove this admin. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_ADMIN_REMOVED,
      actorId,
      targetId: targetUserId,
      targetType: 'user',
      metadata: { institution_id: institutionId, persona_id: target.id, reason: dto.reason },
      req,
    });
  }

  // ── Primary admin transfer (SPEC.md §6.2) ────────────────────────────────

  async transferPrimaryAdmin(
    actorId: string,
    institutionId: string,
    dto: TransferPrimaryAdminDto,
    req?: Request,
  ) {
    if (actorId === dto.targetUserId) {
      throw new BadRequestException('You are already the primary admin');
    }

    const currentPrimary = await this.assertPrimaryAdmin(actorId, institutionId);

    const { data: targetPersona } = await this.supabase
      .from('personas')
      .select('id, status')
      .eq('user_id', dto.targetUserId)
      .eq('institution_id', institutionId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .maybeSingle();

    if (!targetPersona || targetPersona.status !== 'active') {
      throw new BadRequestException('The target must already be an active admin at this institution');
    }

    // Not a real cross-row transaction — this codebase has no transaction
    // helper set up yet (AuthService's refresh-token rotation has the same
    // limitation). Both rows are already validated and the two updates run
    // back-to-back with no branching between them, which keeps the window
    // for a torn write vanishingly small in practice; a future migration
    // to an RPC function (like redeem_batch_code() in 001_initial_schema.sql)
    // would close it entirely.
    const { error: demoteError } = await this.supabase
      .from('personas')
      .update({ is_primary_admin: false })
      .eq('id', currentPrimary.id);

    const { error: promoteError } = await this.supabase
      .from('personas')
      .update({ is_primary_admin: true })
      .eq('id', targetPersona.id);

    if (demoteError || promoteError) {
      this.logger.error('Primary admin transfer partially failed', {
        demoteError,
        promoteError,
        institutionId,
      });
      throw new BadRequestException('Failed to transfer primary admin. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_ADMIN_TRANSFERRED,
      actorId,
      targetId: institutionId,
      targetType: 'institution',
      metadata: { from_user_id: actorId, to_user_id: dto.targetUserId },
      req,
    });
  }

  /**
   * TASKS_11 TASK 01 — thin wrapper so the platform-admin invite route has
   * its own typed call site (institutionId from the body, not a path
   * param) while sharing inviteAdmin()'s actual logic, including its
   * isPlatformAdmin() bypass of the primary-admin check.
   */
  async platformInviteAdmin(platformAdminId: string, dto: PlatformInviteAdminDto, req?: Request) {
    return this.inviteAdmin(platformAdminId, dto.institutionId, { email: dto.email }, req, dto.expiresInDays);
  }

  // ── Internal: access control + capacity ──────────────────────────────────

  /** TASKS_11 TASK 01 — house convention is a private assertX() per service rather than a shared Guard class (see e.g. AdminService.assertPlatformAdmin()). */
  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const { data } = await this.supabase.from('profiles').select('is_platform_admin').eq('id', userId).maybeSingle();
    return !!data?.is_platform_admin;
  }

  private async assertPlatformAdmin(userId: string): Promise<void> {
    if (!(await this.isPlatformAdmin(userId))) {
      throw new ForbiddenException('Platform admin access required');
    }
  }

  /** Throws unless `userId` is the active primary admin of `institutionId`. Returns that persona row. */
  private async assertPrimaryAdmin(userId: string, institutionId: string) {
    const { data } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', userId)
      .eq('institution_id', institutionId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .eq('status', 'active')
      .eq('is_primary_admin', true)
      .maybeSingle();

    if (!data) {
      throw new ForbiddenException('Only the primary admin can perform this action');
    }

    return data;
  }

  /** Throws unless `userId` is ANY active admin (primary or co-admin) of `institutionId`. */
  private async assertActiveAdmin(userId: string, institutionId: string): Promise<void> {
    const { data } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', userId)
      .eq('institution_id', institutionId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .eq('status', 'active')
      .maybeSingle();

    if (!data) {
      throw new ForbiddenException('You are not an active admin at this institution');
    }
  }

  /**
   * SPEC.md §6.2: "Max 5 admins per institution
   * (appConfig.INSTITUTION_MAX_ADMINS)." Counts active + pending_approval
   * personas AND outstanding (unaccepted, unexpired) invites — an invite
   * reserves a slot too, otherwise a primary admin could send more invites
   * than the institution has room for and the cap would only bite whichever
   * invitees happen to accept last, which is a confusing way to fail.
   */
  private async assertAdminCapNotReached(institutionId: string): Promise<void> {
    const { count: personaCount, error: personaError } = await this.supabase
      .from('personas')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .in('status', ['active', 'pending_approval']);

    if (personaError) {
      this.logger.error('Failed to count admin personas', { error: personaError, institutionId });
      throw new BadRequestException('Failed to verify admin capacity. Please try again.');
    }

    const { count: inviteCount, error: inviteError } = await this.supabase
      .from('institution_admin_invites')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString());

    if (inviteError) {
      this.logger.error('Failed to count pending admin invites', { error: inviteError, institutionId });
      throw new BadRequestException('Failed to verify admin capacity. Please try again.');
    }

    const total = (personaCount ?? 0) + (inviteCount ?? 0);
    if (total >= appConfig.INSTITUTION_MAX_ADMINS) {
      throw new ConflictException(
        `This institution has reached the maximum of ${appConfig.INSTITUTION_MAX_ADMINS} admins`,
      );
    }
  }

  /** TASKS_05 TASK 05 — platform admin or an active institution admin. Factored out of uploadLogo() so TASK 03's profile/cover-photo methods below share the exact same check. */
  private async assertActiveAdminOrPlatformAdmin(userId: string, institutionId: string): Promise<void> {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.is_platform_admin) {
      await this.assertActiveAdmin(userId, institutionId);
    }
  }

  // ── Logo ─────────────────────────────────────────────────────────────────

  /**
   * TASKS_08 TASK 04 — uploads to Storage using the service-role client
   * (bypassing RLS, which can never pass for this app's custom-JWT
   * sessions — same root cause as IdentityService.uploadAvatar()'s own
   * comment) instead of the caller uploading directly to Storage and just
   * POSTing the resulting URL here.
   */
  async uploadLogo(userId: string, institutionId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const path = `institutions/${institutionId}/logo.${ext}`;

    const { error: uploadError } = await this.supabase.storage
      .from('institution-assets')
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) {
      this.logger.error('Failed to upload institution logo', { error: uploadError, institutionId });
      throw new BadRequestException('Failed to upload logo. Please try again.');
    }

    const { data: publicUrlData } = this.supabase.storage.from('institution-assets').getPublicUrl(path);
    const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { data, error } = await this.supabase
      .from('institutions')
      .update({ logo_url: logoUrl })
      .eq('id', institutionId)
      .select('id, logoUrl:logo_url')
      .maybeSingle();

    if (error || !data) {
      this.logger.error('Failed to update institution logo', { error, institutionId });
      throw new BadRequestException('Failed to update logo. Please try again.');
    }

    return { logoUrl: data.logoUrl as string };
  }

  // ── Profile / branding (TASKS_11 TASK 03) ────────────────────────────────

  async getProfile(userId: string, institutionId: string) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const { data, error } = await this.supabase
      .from('institutions')
      .select(
        'id, name, slug, type, cityCode:city_code, countryCode:country_code, logoUrl:logo_url, ' +
          'coverPhotoUrl:cover_photo_url, address, website, description, foundedYear:founded_year, board, medium',
      )
      .eq('id', institutionId)
      .maybeSingle();

    if (error || !data) {
      this.appLogger.error('[INST-ADMIN:profile] failed', { institutionId, error: error?.message });
      throw new NotFoundException('Institution not found');
    }

    return data;
  }

  async updateProfile(userId: string, institutionId: string, dto: UpdateInstitutionProfileDto, req?: Request) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.address !== undefined) patch.address = dto.address;
    if (dto.website !== undefined) patch.website = dto.website;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.foundedYear !== undefined) patch.founded_year = dto.foundedYear;
    if (dto.board !== undefined) patch.board = dto.board;
    if (dto.medium !== undefined) patch.medium = dto.medium;

    const { data, error } = await this.supabase
      .from('institutions')
      .update(patch)
      .eq('id', institutionId)
      .select(
        'id, name, address, website, description, foundedYear:founded_year, board, medium',
      )
      .maybeSingle();

    if (error || !data) {
      this.appLogger.error('[INST-ADMIN:profile] failed', { institutionId, error: error?.message });
      throw new BadRequestException('Failed to update institution profile. Please try again.');
    }

    this.appLogger.info('[INST-ADMIN:profile] updated', { institutionId });
    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_PROFILE_UPDATED,
      actorId: userId,
      targetId: institutionId,
      targetType: 'institution',
      metadata: { fields: Object.keys(patch) },
      req,
    });

    return data;
  }

  /** Same pattern as uploadLogo(), different Storage path/column. */
  async uploadCoverPhoto(userId: string, institutionId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const path = `institutions/${institutionId}/cover.${ext}`;

    const { error: uploadError } = await this.supabase.storage
      .from('institution-assets')
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) {
      this.appLogger.error('[INST-ADMIN:logo] failed', { institutionId, error: uploadError.message });
      throw new BadRequestException('Failed to upload cover photo. Please try again.');
    }

    const { data: publicUrlData } = this.supabase.storage.from('institution-assets').getPublicUrl(path);
    const coverPhotoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { data, error } = await this.supabase
      .from('institutions')
      .update({ cover_photo_url: coverPhotoUrl })
      .eq('id', institutionId)
      .select('id, coverPhotoUrl:cover_photo_url')
      .maybeSingle();

    if (error || !data) {
      this.appLogger.error('[INST-ADMIN:logo] failed', { institutionId, error: error?.message });
      throw new BadRequestException('Failed to update cover photo. Please try again.');
    }

    this.appLogger.info('[INST-ADMIN:logo] uploaded', { institutionId });
    return { coverPhotoUrl: data.coverPhotoUrl as string };
  }

  // ── Subscription (TASKS_11 TASK 04) ──────────────────────────────────────
  // No payment processing — same scope limit PremiumService documents for
  // per-user premium (007_premium_module.sql). A row only exists once
  // something has actually happened to the subscription (an upgrade
  // request or a platform-admin PATCH); until then, getSubscription()
  // returns the implicit free/inactive default rather than needing every
  // institution pre-seeded with a row.

  private static readonly DEFAULT_SUBSCRIPTION = {
    plan: 'free' as const,
    status: 'inactive' as const,
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    maxClassrooms: 5,
    maxMembersPerClassroom: 100,
  };

  async getSubscription(userId: string, institutionId: string) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const { data } = await this.supabase
      .from('institution_subscriptions')
      .select(
        'plan, status, trialEndsAt:trial_ends_at, currentPeriodStart:current_period_start, ' +
          'currentPeriodEnd:current_period_end, maxClassrooms:max_classrooms, maxMembersPerClassroom:max_members_per_classroom',
      )
      .eq('institution_id', institutionId)
      .maybeSingle();

    return data ?? InstitutionService.DEFAULT_SUBSCRIPTION;
  }

  async requestSubscriptionUpgrade(userId: string, institutionId: string, dto: RequestSubscriptionUpgradeDto, req?: Request) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const { data: institution } = await this.supabase
      .from('institutions')
      .select('name')
      .eq('id', institutionId)
      .maybeSingle();

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_SUBSCRIPTION_UPGRADE_REQUESTED,
      actorId: userId,
      targetId: institutionId,
      targetType: 'institution',
      metadata: { plan: dto.plan, message: dto.message ?? null },
      req,
    });

    this.eventEmitter.emit('institution.subscription.upgrade_requested', {
      institutionId,
      institutionName: institution?.name ?? null,
      userId,
      message: dto.message,
    });

    return { message: 'Upgrade request sent. We will contact you shortly.' };
  }

  /** Platform admin only — upserts since most institutions have no row yet (see this section's own comment). */
  async updateSubscription(platformAdminId: string, institutionId: string, dto: UpdateInstitutionSubscriptionDto, req?: Request) {
    await this.assertPlatformAdmin(platformAdminId);

    const patch: Record<string, unknown> = { institution_id: institutionId, updated_at: new Date().toISOString() };
    if (dto.plan !== undefined) patch.plan = dto.plan;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.trialEndsAt !== undefined) patch.trial_ends_at = dto.trialEndsAt;
    if (dto.currentPeriodEnd !== undefined) patch.current_period_end = dto.currentPeriodEnd;
    if (dto.maxClassrooms !== undefined) patch.max_classrooms = dto.maxClassrooms;
    if (dto.maxMembersPerClassroom !== undefined) patch.max_members_per_classroom = dto.maxMembersPerClassroom;

    // `as any` — same reasoning as getMessages()'s own cast for this
    // exact combination (a dynamic aliased select string loses proper
    // type inference on .maybeSingle(), worse here since it's chained
    // off .upsert() too).
    const { data, error } = (await this.supabase
      .from('institution_subscriptions')
      .upsert(patch, { onConflict: 'institution_id' })
      .select(
        'plan, status, trialEndsAt:trial_ends_at, currentPeriodEnd:current_period_end, ' +
          'maxClassrooms:max_classrooms, maxMembersPerClassroom:max_members_per_classroom',
      )
      .maybeSingle()) as any;

    if (error || !data) {
      this.appLogger.error('[INST-ADMIN:subscription] failed', { institutionId, error: error?.message });
      throw new BadRequestException('Failed to update subscription. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_SUBSCRIPTION_UPDATED,
      actorId: platformAdminId,
      targetId: institutionId,
      targetType: 'institution',
      metadata: { plan: data.plan, status: data.status },
      req,
    });

    this.eventEmitter.emit('institution.subscription.updated', { institutionId, plan: data.plan, status: data.status });

    return data;
  }

  // ── Classroom-level admin roster + promote/demote (TASKS_11 TASK 05) ────
  // Distinct from listAdmins()/inviteAdmin() above, which manage
  // INSTITUTION-level personas (school_admin). These two methods manage
  // membership.role='admin' across every classroom the institution owns —
  // MembershipService.changeRole() already does this exact promote/demote,
  // but only lets a classroom's OWN admin call it for that one classroom;
  // an institution admin needs to do it across ALL of their classrooms, so
  // this is a self-contained sibling rather than a change to that method's
  // existing, tested single-classroom scope.

  async listClassroomAdmins(callerId: string, institutionId: string) {
    await this.assertActiveAdminOrPlatformAdmin(callerId, institutionId);

    const { data: classrooms } = await this.supabase
      .from('classrooms')
      .select('id, global_id, name')
      .eq('institution_id', institutionId);

    const classroomIds = (classrooms ?? []).map((c) => c.id);
    if (classroomIds.length === 0) return [];

    const { data: memberships, error } = await this.supabase
      .from('memberships')
      .select('user_id, classroom_id, joined_at, profile:profiles(id, full_name, avatar_url)')
      .in('classroom_id', classroomIds)
      .eq('role', MemberRole.ADMIN);

    if (error) {
      this.appLogger.error('[INST-ADMIN:classroom-admins] failed', { institutionId, error: error.message });
      throw new BadRequestException('Failed to load classroom admins');
    }

    const classroomById = new Map((classrooms ?? []).map((c) => [c.id, c]));

    return (memberships ?? []).map((m: any) => ({
      userId: m.user_id,
      classroomId: m.classroom_id,
      classroom: classroomById.get(m.classroom_id) ?? null,
      since: m.joined_at,
      profile: m.profile,
    }));
  }

  async setClassroomAdminRole(actorId: string, institutionId: string, dto: SetClassroomAdminRoleDto, req?: Request) {
    await this.assertActiveAdminOrPlatformAdmin(actorId, institutionId);

    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('id')
      .eq('id', dto.classroomId)
      .eq('institution_id', institutionId)
      .maybeSingle();

    if (!classroom) {
      throw new NotFoundException('This classroom does not belong to your institution');
    }

    const { data: membership } = await this.supabase
      .from('memberships')
      .select('id, role')
      .eq('user_id', dto.userId)
      .eq('classroom_id', dto.classroomId)
      .maybeSingle();

    if (!membership) {
      throw new NotFoundException('This user is not a member of this classroom');
    }

    const fromRole = membership.role as MemberRole;
    let toRole: MemberRole;

    if (dto.action === 'promote') {
      toRole = MemberRole.ADMIN;
    } else {
      if (fromRole !== MemberRole.ADMIN) {
        throw new BadRequestException('This member is not currently an admin of this classroom');
      }

      const { count } = await this.supabase
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('classroom_id', dto.classroomId)
        .eq('role', MemberRole.ADMIN);

      if ((count ?? 0) <= 1) {
        throw new BadRequestException('Cannot demote the only admin of this classroom. Promote another member first.');
      }

      // TASKS_11 TASK 05 — "revert to their original role, check
      // verification_method to determine original role" per the task's
      // literal text doesn't quite work (verification_method is about HOW
      // they verified, not WHAT role they held) — same persona-based
      // derivation TASKS_10 TASK 03 already established for
      // ClassroomService.createClassroom()'s creatorRole is reused here
      // instead: an active teacher persona at this institution reverts to
      // 'teacher', otherwise 'student'.
      const { data: teacherPersona } = await this.supabase
        .from('personas')
        .select('id')
        .eq('user_id', dto.userId)
        .eq('type', PersonaType.TEACHER)
        .eq('institution_id', institutionId)
        .eq('status', 'active')
        .maybeSingle();
      toRole = teacherPersona ? MemberRole.TEACHER : MemberRole.STUDENT;
    }

    const { error } = await this.supabase.from('memberships').update({ role: toRole }).eq('id', membership.id);

    if (error) {
      this.appLogger.error('[INST-ADMIN:roles] failed', { institutionId, error: error.message });
      throw new BadRequestException('Failed to change this member’s role. Please try again.');
    }

    this.appLogger.info(`[INST-ADMIN:roles] ${dto.action === 'promote' ? 'promoted' : 'demoted'}`, { userId: dto.userId, classroomId: dto.classroomId });
    await this.audit.log({
      eventType: dto.action === 'promote' ? AuditEventType.CLASSROOM_ADMIN_PROMOTED : AuditEventType.CLASSROOM_ADMIN_DEMOTED,
      actorId,
      targetId: dto.userId,
      targetType: 'membership',
      metadata: { classroom_id: dto.classroomId, institution_id: institutionId, from_role: fromRole, to_role: toRole },
      req,
    });

    this.eventEmitter.emit('institution.classroom_admin.role_changed', {
      userId: dto.userId,
      classroomId: dto.classroomId,
      action: dto.action,
    });

    return { userId: dto.userId, classroomId: dto.classroomId, role: toRole };
  }

  // ── Classroom create/edit/archive (TASKS_11 TASK 07) ─────────────────────
  // List already exists (AdminService.getClassroomsByYear(), used by
  // ClassroomsTab) — not duplicated here.

  /** Delegates to ClassroomService.createClassroom() — see ClassroomModule import in institution.module.ts. creatorRole is forced to 'admin': an institution admin creating a classroom from this dashboard should land as its admin, not whatever their own persona would otherwise map to. */
  async createClassroomForInstitution(actorId: string, institutionId: string, dto: CreateClassroomForInstitutionDto, req?: Request) {
    await this.assertActiveAdminOrPlatformAdmin(actorId, institutionId);

    return this.classroomService.createClassroom(
      actorId,
      {
        institutionId,
        name: dto.name,
        batchYear: dto.batchYear,
        grade: dto.grade,
        section: dto.section,
        program: dto.program,
        hasStaffRoom: dto.hasTeacherRoom,
        requireVerification: dto.requireVerification,
        creatorRole: 'admin',
      },
      req,
    );
  }

  /**
   * TASKS_11 TASK 07 — institution admin editing ANY classroom in their
   * institution. Deliberately NOT ClassroomService.updateClassroom(),
   * which requires being that specific classroom's own admin (its own
   * doc comment: "school-admin personas do not implicitly grant this").
   * This is a new, additive capability for the institution-wide dashboard,
   * not a change to that existing rule.
   */
  async updateClassroomForInstitution(actorId: string, institutionId: string, classroomId: string, dto: UpdateClassroomForInstitutionDto, req?: Request) {
    await this.assertActiveAdminOrPlatformAdmin(actorId, institutionId);

    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('id')
      .eq('id', classroomId)
      .eq('institution_id', institutionId)
      .maybeSingle();

    if (!classroom) {
      throw new NotFoundException('This classroom does not belong to your institution');
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.hasTeacherRoom !== undefined) patch.has_staff_room = dto.hasTeacherRoom;
    if (dto.requireVerification !== undefined) patch.require_verification = dto.requireVerification;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No updatable fields were provided');
    }

    const { data, error } = await this.supabase.from('classrooms').update(patch).eq('id', classroomId).select().maybeSingle();

    if (error || !data) {
      this.appLogger.error('[INST-ADMIN:classroom] failed', { classroomId, error: error?.message });
      throw new BadRequestException('Failed to update this classroom. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.CLASSROOM_SETTINGS_UPDATED,
      actorId,
      targetId: classroomId,
      targetType: 'classroom',
      metadata: { changes: patch, via: 'institution_admin' },
      req,
    });

    return data;
  }

  /** Archived classrooms are read-only — CorridorService.sendMessage() rejects new posts while archived_at is set. Members keep read access and membership. */
  async archiveClassroom(actorId: string, institutionId: string, classroomId: string, req?: Request) {
    await this.assertActiveAdminOrPlatformAdmin(actorId, institutionId);

    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('id, archived_at')
      .eq('id', classroomId)
      .eq('institution_id', institutionId)
      .maybeSingle();

    if (!classroom) {
      throw new NotFoundException('This classroom does not belong to your institution');
    }
    if (classroom.archived_at) {
      throw new ConflictException('This classroom is already archived');
    }

    const { data, error } = await this.supabase
      .from('classrooms')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', classroomId)
      .select()
      .maybeSingle();

    if (error || !data) {
      this.appLogger.error('[INST-ADMIN:classroom] failed', { classroomId, error: error?.message });
      throw new BadRequestException('Failed to archive this classroom. Please try again.');
    }

    this.appLogger.info('[INST-ADMIN:classroom] archived', { classroomId });
    await this.audit.log({
      eventType: AuditEventType.CLASSROOM_ARCHIVED,
      actorId,
      targetId: classroomId,
      targetType: 'classroom',
      metadata: { institution_id: institutionId },
      req,
    });

    return data;
  }

  // ── Announcements (TASKS_11 TASK 08) ─────────────────────────────────────

  async listAnnouncements(userId: string, institutionId: string) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const { data, error } = await this.supabase
      .from('institution_announcements')
      .select('id, title, body, target, target_classroom_ids, sent_at, recipient_count')
      .eq('institution_id', institutionId)
      .order('sent_at', { ascending: false });

    if (error) {
      this.appLogger.error('[INST-ADMIN:announce] failed', { institutionId, error: error.message });
      throw new BadRequestException('Failed to load announcements');
    }

    return data ?? [];
  }

  /** Verified members across the institution's classrooms, deduplicated by user_id — optionally scoped to specific classrooms. Shared by both the "preview recipient count" call and the actual send. */
  private async resolveAnnouncementRecipients(institutionId: string, target: 'all' | 'specific', classroomIds?: string[]): Promise<string[]> {
    let classroomQuery = this.supabase.from('classrooms').select('id').eq('institution_id', institutionId);
    if (target === 'specific' && classroomIds) {
      classroomQuery = classroomQuery.in('id', classroomIds);
    }
    const { data: classrooms } = await classroomQuery;
    const scopedClassroomIds = (classrooms ?? []).map((c) => c.id);
    if (scopedClassroomIds.length === 0) return [];

    const { data: memberships } = await this.supabase
      .from('memberships')
      .select('user_id')
      .in('classroom_id', scopedClassroomIds)
      .eq('verification_status', 'verified');

    return [...new Set((memberships ?? []).map((m) => m.user_id))];
  }

  async getAnnouncementRecipientCount(userId: string, institutionId: string, target: 'all' | 'specific', classroomIds?: string[]) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);
    const recipients = await this.resolveAnnouncementRecipients(institutionId, target, classroomIds);
    return { recipientCount: recipients.length };
  }

  async sendAnnouncement(userId: string, institutionId: string, dto: SendInstitutionAnnouncementDto, req?: Request) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const recipients = await this.resolveAnnouncementRecipients(institutionId, dto.target, dto.targetClassroomIds);

    const { data: announcement, error } = await this.supabase
      .from('institution_announcements')
      .insert({
        institution_id: institutionId,
        created_by: userId,
        title: dto.title,
        body: dto.body,
        target: dto.target,
        target_classroom_ids: dto.target === 'specific' ? dto.targetClassroomIds : [],
        recipient_count: recipients.length,
      })
      .select('id')
      .single();

    if (error || !announcement) {
      this.appLogger.error('[INST-ADMIN:announce] failed', { institutionId, error: error?.message });
      throw new BadRequestException('Failed to send this announcement. Please try again.');
    }

    const { data: institution } = await this.supabase.from('institutions').select('name').eq('id', institutionId).maybeSingle();

    this.appLogger.info('[INST-ADMIN:announce] sent', { institutionId, announcementId: announcement.id, recipientCount: recipients.length });

    // Hand-off to NotificationService — same "this module doesn't deliver
    // notifications itself" pattern every other emit site in this
    // codebase follows. Fan-out to potentially hundreds of recipients
    // happens in the listener, not here, so this request returns quickly.
    this.eventEmitter.emit('institution.announcement.sent', {
      institutionId,
      institutionName: institution?.name ?? null,
      announcementId: announcement.id,
      title: dto.title,
      body: dto.body,
      recipientUserIds: recipients,
    });

    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_ANNOUNCEMENT_SENT,
      actorId: userId,
      targetId: announcement.id,
      // 'institution' — AuditLogParams.targetType has no dedicated
      // 'institution_announcement' category and announcement rows have no
      // other audit-trail entry type to share; the announcement_id is
      // still in targetId and institution_id in metadata below.
      targetType: 'institution',
      metadata: { institution_id: institutionId, target: dto.target, recipient_count: recipients.length },
      req,
    });

    return { announcementId: announcement.id, recipientCount: recipients.length };
  }

  // ── Member management (TASKS_11 TASK 09) ─────────────────────────────────

  /**
   * search (name/email) is applied in application code, not the DB query —
   * Supabase's JS client can't `.ilike()` a column on an embedded relation
   * (profile.full_name/email) in one query. Fine at this scale (an
   * institution-admin tool, not a user-facing hot path); ordering and the
   * other filters still happen server-side first.
   */
  async listMembers(userId: string, institutionId: string, dto: ListInstitutionMembersDto) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    let classroomQuery = this.supabase.from('classrooms').select('id, global_id, name').eq('institution_id', institutionId);
    if (dto.classroomId) {
      classroomQuery = classroomQuery.eq('id', dto.classroomId);
    }
    const { data: classrooms } = await classroomQuery;
    const classroomIds = (classrooms ?? []).map((c) => c.id);
    if (classroomIds.length === 0) return { members: [], total: 0 };

    const classroomById = new Map((classrooms ?? []).map((c) => [c.id, c]));

    let query = this.supabase
      .from('memberships')
      .select('user_id, classroom_id, role, verification_status, verification_method, joined_at, profile:profiles(id, full_name, avatar_url, email)')
      .in('classroom_id', classroomIds)
      .order('joined_at', { ascending: false });

    if (dto.role) query = query.eq('role', dto.role);
    if (dto.verificationStatus) query = query.eq('verification_status', dto.verificationStatus);

    const { data, error } = (await query) as any;

    if (error) {
      this.appLogger.error('[INST-ADMIN:members] failed', { institutionId, error: error.message });
      throw new BadRequestException('Failed to load members');
    }

    const searchLower = dto.search?.trim().toLowerCase();
    const filtered = searchLower
      ? (data ?? []).filter(
          (m: any) =>
            m.profile?.full_name?.toLowerCase().includes(searchLower) || m.profile?.email?.toLowerCase().includes(searchLower),
        )
      : data ?? [];

    const { from, to } = getRange(dto.page ?? 0, dto.limit ?? 50);
    const page = filtered.slice(from, to + 1);

    this.appLogger.debug('[INST-ADMIN:members] query', { institutionId, filters: dto, count: filtered.length });

    return {
      members: page.map((m: any) => ({
        id: m.profile?.id,
        fullName: m.profile?.full_name ?? null,
        email: m.profile?.email ?? null,
        avatarUrl: m.profile?.avatar_url ?? null,
        role: m.role,
        verificationStatus: m.verification_status,
        verificationMethod: m.verification_method,
        joinedAt: m.joined_at,
        classroom: classroomById.get(m.classroom_id) ?? null,
      })),
      total: filtered.length,
    };
  }

  async getMemberDetail(userId: string, institutionId: string, targetUserId: string) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url, bio')
      .eq('id', targetUserId)
      .maybeSingle();

    if (!profile) {
      throw new NotFoundException('Member not found');
    }

    const { data: classrooms } = await this.supabase.from('classrooms').select('id, global_id, name').eq('institution_id', institutionId);
    const classroomIds = (classrooms ?? []).map((c) => c.id);
    const classroomById = new Map((classrooms ?? []).map((c) => [c.id, c]));

    const { data: memberships } = await this.supabase
      .from('memberships')
      .select('classroom_id, role, verification_status, verification_method, joined_at')
      .eq('user_id', targetUserId)
      .in('classroom_id', classroomIds.length > 0 ? classroomIds : ['00000000-0000-0000-0000-000000000000']);

    return {
      profile,
      memberships: (memberships ?? []).map((m) => ({
        classroom: classroomById.get(m.classroom_id) ?? null,
        role: m.role,
        verificationStatus: m.verification_status,
        verificationMethod: m.verification_method,
        joinedAt: m.joined_at,
      })),
    };
  }

  // ── Verification management (TASKS_11 TASK 10) ───────────────────────────
  // Broader than AdminService.getPendingDocumentVerifications() (method=
  // 'document', status='pending' only) — this covers every method/status,
  // for the history view and filters this task wants. The actual
  // approve/reject ACTIONS for document verifications stay on
  // AdminController's existing MFA-gated routes (AdminService.
  // approveVerificationDocument()/rejectVerificationDocument(), which
  // already correctly update both tables and notify the applicant) —
  // not duplicated here. Document signed URLs are likewise still fetched
  // on demand via the existing GET .../verifications/:id/document route,
  // not eagerly embedded in this list (avoids generating signed URLs for
  // rows nobody actually opens).
  async listVerifications(userId: string, institutionId: string, dto: ListInstitutionVerificationsDto) {
    await this.assertActiveAdminOrPlatformAdmin(userId, institutionId);

    let classroomQuery = this.supabase.from('classrooms').select('id, global_id, name').eq('institution_id', institutionId);
    if (dto.classroomId) classroomQuery = classroomQuery.eq('id', dto.classroomId);
    const { data: classrooms } = await classroomQuery;
    const classroomIds = (classrooms ?? []).map((c) => c.id);
    if (classroomIds.length === 0) return { verifications: [], total: 0 };
    const classroomById = new Map((classrooms ?? []).map((c) => [c.id, c]));

    let query = this.supabase
      .from('verifications')
      .select(
        'id, user_id, classroom_id, method, status, document_storage_path, vouches, created_at, reviewed_at, rejection_reason, ' +
          'profile:profiles(id, full_name, avatar_url, email)',
      )
      .in('classroom_id', classroomIds);

    if (dto.status) query = query.eq('status', dto.status);
    if (dto.method) query = query.eq('method', dto.method);

    const { data, error } = (await query) as any;

    if (error) {
      this.appLogger.error('[INST-ADMIN:verify] failed', { institutionId, error: error.message });
      throw new BadRequestException('Failed to load verifications');
    }

    // Pending first, then by submitted_at ASC within each group — a
    // single .order() can't express "pending first" without a second,
    // non-column sort key, so this sorts in application code instead.
    const sorted = [...(data ?? [])].sort((a: any, b: any) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    const { from, to } = getRange(dto.page ?? 0, dto.limit ?? 50);
    const page = sorted.slice(from, to + 1);

    // Voucher full names — vouches jsonb intentionally excludes full_name
    // (see 001_initial_schema.sql's own column comment), joined here at
    // read time instead.
    const voucherIds = [...new Set(page.flatMap((v: any) => (v.vouches ?? []).map((voucher: any) => voucher.user_id)))];
    let voucherNameById = new Map<string, string>();
    if (voucherIds.length > 0) {
      const { data: voucherProfiles } = await this.supabase.from('profiles').select('id, full_name').in('id', voucherIds);
      voucherNameById = new Map((voucherProfiles ?? []).map((p) => [p.id, p.full_name]));
    }

    return {
      verifications: page.map((v: any) => ({
        id: v.id,
        userId: v.user_id,
        user: v.profile,
        classroom: classroomById.get(v.classroom_id) ?? null,
        method: v.method,
        status: v.status,
        hasDocument: !!v.document_storage_path,
        vouches: (v.vouches ?? []).map((voucher: any) => ({
          userId: voucher.user_id,
          fullName: voucherNameById.get(voucher.user_id) ?? null,
          role: voucher.role,
          vouchedAt: voucher.vouched_at,
        })),
        submittedAt: v.created_at,
        reviewedAt: v.reviewed_at,
        rejectionReason: v.rejection_reason,
      })),
      total: sorted.length,
    };
  }
}
