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
import { AuditEventType, ErrorCode, PersonaType } from '@alumini/types';
import { isExpired } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';

import { SearchInstitutionsDto } from './dto/search-institutions.dto';
import { RequestInstitutionDto } from './dto/request-institution.dto';
import { ClaimInstitutionDto } from './dto/claim-institution.dto';
import { RejectClaimDto } from './dto/reject-claim.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { RemoveAdminDto } from './dto/remove-admin.dto';
import { TransferPrimaryAdminDto } from './dto/transfer-admin.dto';

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
    const persona = await this.getPendingClaim(personaId);

    const { data: institution } = await this.supabase
      .from('institutions')
      .select('id, is_claimed')
      .eq('id', persona.institution_id)
      .single();

    if (institution?.is_claimed) {
      // Another claim for the same institution was approved first — see
      // submitClaim()'s comment on why is_primary_admin isn't decided at
      // submission time.
      throw new ConflictException('This institution has already been claimed by another approved admin');
    }

    const now = new Date().toISOString();

    this.appLogger.debug('[INSTITUTION:approve] activating claim', { institutionId: persona.institution_id, userId: persona.user_id });

    const { error: personaError } = await this.supabase
      .from('personas')
      .update({ status: 'active', is_primary_admin: true })
      .eq('id', personaId);

    const { error: institutionError } = await this.supabase
      .from('institutions')
      .update({ is_claimed: true, claimed_by: persona.user_id, claimed_at: now })
      .eq('id', persona.institution_id);

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

    this.appLogger.info('[INSTITUTION:approve] success', { institutionId: persona.institution_id, userId: persona.user_id });
    await this.audit.log({
      eventType: AuditEventType.INSTITUTION_CLAIM_APPROVED,
      actorId: approverId,
      targetId: persona.institution_id,
      targetType: 'institution',
      metadata: { persona_id: personaId, new_primary_admin: persona.user_id },
      req,
    });

    this.eventEmitter.emit('institution.claim.approved', {
      institutionId: persona.institution_id,
      userId: persona.user_id,
    });

    return { institutionId: persona.institution_id, userId: persona.user_id, isPrimaryAdmin: true };
  }

  /** Rejects a pending claim. Same "no public route" reasoning as approveClaim(). */
  async rejectClaim(approverId: string, personaId: string, dto: RejectClaimDto, req?: Request) {
    this.appLogger.debug('[INSTITUTION:reject] entry', { requestId: personaId, adminId: approverId });
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

    const { data: admins, error } = await this.supabase
      .from('personas')
      .select(
        'id, user_id, status, is_primary_admin, created_at, ' +
          'profile:profiles(id, full_name, avatar_url)',
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

  async inviteAdmin(actorId: string, institutionId: string, dto: InviteAdminDto, req?: Request) {
    await this.assertPrimaryAdmin(actorId, institutionId);
    await this.assertAdminCapNotReached(institutionId);

    const expiresAt = new Date(Date.now() + appConfig.ADMIN_INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

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
      expiresIn: `${appConfig.ADMIN_INVITE_EXPIRY_HOURS}h`,
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
  async acceptInvite(token: string, req?: Request) {
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
    const { data: persona, error: insertError } = await this.supabase
      .from('personas')
      .insert({
        user_id: profile.id,
        type: PersonaType.SCHOOL_ADMIN,
        institution_id: invite.institution_id,
        status: 'active',
        is_primary_admin: false,
      })
      .select()
      .single();

    if (insertError || !persona) {
      this.logger.error('Failed to create co-admin persona', { error: insertError, invite });
      throw new ConflictException('This invitation could not be completed. Please try again.');
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

    return persona;
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

  // ── Internal: access control + capacity ──────────────────────────────────

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

  // ── Logo ─────────────────────────────────────────────────────────────────

  /**
   * TASKS_05 TASK 05 — platform admin or an active institution admin.
   * See UpdateLogoDto's own comment on why this takes a Storage URL rather
   * than the file itself.
   */
  /**
   * TASKS_08 TASK 04 — uploads to Storage using the service-role client
   * (bypassing RLS, which can never pass for this app's custom-JWT
   * sessions — same root cause as IdentityService.uploadAvatar()'s own
   * comment) instead of the caller uploading directly to Storage and just
   * POSTing the resulting URL here.
   */
  async uploadLogo(userId: string, institutionId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.is_platform_admin) {
      await this.assertActiveAdmin(userId, institutionId);
    }

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
}
