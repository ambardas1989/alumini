/**
 * IdentityService — user profile management and the persona system
 * (SPEC.md §6, module boundary in SPEC.md §15.3: "identity/ → user
 * profiles, personas, persona switching").
 *
 * OWNERSHIP
 * Owns reads/updates of `profiles` and all of `personas`. Does NOT create
 * profile rows — that happens via the `handle_new_user` DB trigger when the
 * auth module signs a user up (001_initial_schema.sql).
 *
 * PERSONA RULES (SPEC.md §6.1, §6.2)
 * - A user can hold any combination of alumni / teacher / school_admin
 *   personas. alumni has institution_id = null and is capped at one per
 *   user (personas_alumni_unique_idx, a partial unique index, in
 *   001_initial_schema.sql). teacher / school_admin are scoped to one
 *   institution each — a user CAN hold several of the same type across
 *   different institutions (e.g. a teacher at two schools).
 * - alumni and teacher personas go 'active' immediately on creation.
 * - school_admin personas always start 'pending_approval'. Nothing in this
 *   service — not addPersona(), not switchPersona(), not updateProfile() —
 *   ever writes 'active' for a school_admin row. That transition is the
 *   institution-claim approval flow (SPEC.md §11.1), owned by a platform-
 *   admin-only process in a module this codebase hasn't built yet. This is
 *   what makes "cannot be self-approved under any circumstances" hold: even
 *   if a client calls every endpoint in this file in any order, there is no
 *   code path here that flips that status.
 * - Switching sets profiles.active_persona, which SPEC.md §16.1 defines as
 *   a bare type string ('alumni' | 'teacher' | 'school_admin') — it does
 *   NOT track *which* institution's teacher/school_admin persona is active
 *   for users who hold more than one of the same type. That's a limitation
 *   of the schema as specified, not something this module invents a
 *   workaround for.
 *
 * AUDIT
 * Every persona add/switch writes to audit_logs via AuditService
 * (AuditEventType.PERSONA_ADDED / PERSONA_SWITCHED). Plain profile field
 * edits (name/avatar/phone/LinkedIn) are NOT audited — SPEC.md §14.2's
 * event list doesn't include them, unlike auth/MFA/verification events.
 *
 * CONFIG
 * The only tunable this module touches is appConfig.INSTITUTION_MAX_ADMINS
 * — never hardcoded.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType, ErrorCode, PersonaType } from '@alumini/types';
import { appConfig } from '@alumini/config/app';

import { UpdateProfileDto } from './dto/update-profile.dto';
import { AddPersonaDto } from './dto/add-persona.dto';
import { SwitchPersonaDto } from './dto/switch-persona.dto';
import { SaveLinkedinDto } from './dto/save-linkedin.dto';

type PersonaStatus = 'active' | 'pending_approval';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(
    private readonly audit: AuditService,
    private readonly eventEmitter: EventEmitter2,
    appLogger: AppLogger,
  ) {
    this.appLogger = appLogger.setContext('IDENTITY');
    // Service role — bypasses RLS, same pattern as every other module.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  /**
   * Returns the caller's own full profile row — never another user's.
   *
   * BACKEND FIX 4 investigation: this already uses the service-role client
   * (bypasses RLS — see the constructor) and `userId` is `authToken.sub`,
   * passed straight through from JwtStrategy.validate() with no
   * reshaping (see jwt.strategy.ts / current-user.decorator.ts) — there is
   * no code path here where the wrong id gets looked up. A 404 from this
   * method means literally no `profiles` row exists for that id. Every
   * account created through POST /auth/signup goes through
   * supabase.auth.admin.createUser(), which inserts into `auth.users` and
   * fires the `handle_new_user` trigger (001_initial_schema.sql) that
   * creates the matching `profiles` row — so a normally-signed-up account
   * should never hit this. If it reproduces, the debug log below is the
   * fastest way to confirm whether the id being looked up is what's
   * expected before chasing it further as a one-off data gap (e.g. an
   * account created outside the normal signup flow).
   */
  async getProfile(userId: string) {
    this.appLogger.debug('Profile fetch', { userId });

    // BUG FIX (FIX 2 — profile page errors despite a 200 response): every
    // field here except isPlatformAdmin was selected under its raw
    // snake_case column name, so the response body was
    // { full_name, avatar_url, active_persona, created_at, ... } while the
    // frontend's Profile type (and every render site) reads camelCase
    // (profile.fullName, profile.createdAt, ...). Those all came back
    // `undefined` — most silently, but profile.createdAt feeding
    // formatDate() -> new Date(undefined) -> Intl.DateTimeFormat.format()
    // throws RangeError: Invalid time value, which is what actually
    // crashed the page render. Every field now gets the same
    // alias:column treatment isPlatformAdmin already had.
    const { data: profile, error } = await this.supabase
      .from('profiles')
      .select(
        'id, email, fullName:full_name, avatarUrl:avatar_url, phone, ' +
          'mfaEnabled:mfa_enabled, mfaMethod:mfa_method, ' +
          'isPlatformAdmin:is_platform_admin, ' +
          'activePersona:active_persona, linkedinUrl:linkedin_url, linkedinVerified:linkedin_verified, ' +
          'linkedinConnected:linkedin_connected, linkedinName:linkedin_name, linkedinAvatarUrl:linkedin_avatar_url, ' +
          'createdAt:created_at, updatedAt:updated_at',
      )
      .eq('id', userId)
      .single();

    if (error || !profile) {
      this.appLogger.error('Profile fetch failed', { userId, error: error?.message });
      this.logger.error('[PROFILE-DEBUG] Profile not found', { userId, error });
      // FRONTEND FIX 1: a plain string NotFoundException serializes with
      // Nest's default `error: 'Not Found'` — not one of this app's
      // ErrorCode values — so lib/errors.ts's getErrorMessage() couldn't
      // recognise it and fell through to the generic "Something went
      // wrong" fallback instead of a profile-specific message.
      throw new NotFoundException({
        message: 'Profile not found',
        error: ErrorCode.PROFILE_NOT_FOUND,
      });
    }

    return profile;
  }

  /** Updates whichever caller-editable fields were supplied. See UpdateProfileDto for what's excluded and why. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const patch: Record<string, unknown> = {};
    if (dto.fullName !== undefined) patch.full_name = dto.fullName;
    if (dto.avatarUrl !== undefined) patch.avatar_url = dto.avatarUrl;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.linkedinUrl !== undefined) patch.linkedin_url = dto.linkedinUrl;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No updatable fields were provided');
    }

    const { data, error } = await this.supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select(
        'id, email, fullName:full_name, avatarUrl:avatar_url, phone, ' +
          'activePersona:active_persona, linkedinUrl:linkedin_url, updatedAt:updated_at',
      )
      .single();

    if (error || !data) {
      this.logger.error('Failed to update profile', { error, userId });
      throw new BadRequestException('Failed to update profile. Please try again.');
    }

    this.appLogger.info('Profile updated', { userId, fields: Object.keys(dto) });

    return data;
  }

  // ── Personas: list ───────────────────────────────────────────────────────

  /** Every persona on the caller's account — powers the persona switcher UI. */
  async listPersonas(userId: string) {
    const { data, error } = await this.supabase
      .from('personas')
      .select(
        'id, type, institution_id, status, is_primary_admin, created_at, ' +
          'institution:institutions(id, name, slug, type)',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to list personas', { error, userId });
      throw new BadRequestException('Failed to load personas');
    }

    return data ?? [];
  }

  // ── Personas: add ────────────────────────────────────────────────────────

  /**
   * Adds a new persona to the caller's account (SPEC.md §5.4 — "Adding a
   * Persona to Existing Account"). Does NOT switch the caller into it —
   * adding and switching are separate, explicit actions; call
   * POST /identity/personas/switch afterwards if that's the desired UX.
   * (For school_admin this is moot anyway: it starts pending_approval, and
   * switchPersona() refuses to activate anything that isn't 'active'.)
   */
  async addPersona(userId: string, dto: AddPersonaDto, req?: Request) {
    if (dto.type === PersonaType.ALUMNI) {
      if (dto.institutionId) {
        throw new BadRequestException('Alumni personas are not tied to an institution');
      }
      // No pre-insert duplicate check needed here — personas_alumni_unique_idx
      // is a single global constraint per user, and createPersona() already
      // turns any insert failure into a clean ConflictException.
      return this.createPersona(userId, PersonaType.ALUMNI, null, 'active', req);
    }

    // teacher / school_admin are both institution-scoped.
    if (!dto.institutionId) {
      throw new BadRequestException(`institutionId is required for a ${dto.type} persona`);
    }

    const { data: institution } = await this.supabase
      .from('institutions')
      .select('id')
      .eq('id', dto.institutionId)
      .maybeSingle();

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    // Friendlier than surfacing the raw UNIQUE(user_id, type, institution_id)
    // constraint violation — same pattern ClassroomService uses for global_id.
    const { data: existing } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', userId)
      .eq('type', dto.type)
      .eq('institution_id', dto.institutionId)
      .maybeSingle();

    if (existing) {
      throw new ConflictException(`You already have a ${dto.type} persona at this institution`);
    }

    if (dto.type === PersonaType.SCHOOL_ADMIN) {
      await this.assertAdminCapNotReached(dto.institutionId);

      const persona = await this.createPersona(
        userId,
        PersonaType.SCHOOL_ADMIN,
        dto.institutionId,
        'pending_approval',
        req,
      );

      // Hand off to whichever module ends up owning the platform-admin
      // approval queue/notification — mirrors how VerificationService emits
      // rather than sending the notification itself.
      this.eventEmitter.emit('identity.persona.pending_approval', {
        personaId: persona.id,
        userId,
        institutionId: dto.institutionId,
      });

      return persona;
    }

    // Teacher — active immediately. Per-classroom verification (SPEC.md
    // §8.2 — 5+ student vouches or an appointment letter) happens later, at
    // the membership level, in a module this codebase hasn't built yet.
    return this.createPersona(userId, PersonaType.TEACHER, dto.institutionId, 'active', req);
  }

  private async createPersona(
    userId: string,
    type: PersonaType,
    institutionId: string | null,
    status: PersonaStatus,
    req?: Request,
  ) {
    const { data, error } = await this.supabase
      .from('personas')
      .insert({
        user_id: userId,
        type,
        institution_id: institutionId,
        status,
        // is_primary_admin is never set true from this generic "add a
        // persona" endpoint — "first admin = primary" is decided by the
        // institution-claim flow (SPEC.md §11.1), not by insertion order here.
        is_primary_admin: false,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error('Failed to create persona', { error, userId, type, institutionId });
      // The DB's own unique indexes (personas_alumni_unique_idx,
      // UNIQUE(user_id, type, institution_id)) are the last line of defence
      // against the race the pre-insert duplicate check above can't fully close.
      throw new ConflictException('This persona already exists or could not be created');
    }

    await this.audit.log({
      eventType: AuditEventType.PERSONA_ADDED,
      actorId: userId,
      targetId: userId,
      targetType: 'user',
      metadata: { persona_id: data.id, type, institution_id: institutionId, status },
      req,
    });

    return data;
  }

  /**
   * SPEC.md §6.2: "Max 5 admins per institution (configurable:
   * appConfig.INSTITUTION_MAX_ADMINS)." Counts both 'active' and
   * 'pending_approval' admins — a pending request still occupies a slot, so
   * the queue can't be flooded past the cap for an institution that's
   * already full. (001_initial_schema.sql's check_admin_limit() DB trigger
   * only guards status='active' at insert/update time; this is a stricter,
   * friendlier pre-check that also covers the pending case and returns a
   * clean 409 instead of a raw Postgres exception.)
   */
  private async assertAdminCapNotReached(institutionId: string): Promise<void> {
    const { count, error } = await this.supabase
      .from('personas')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .in('status', ['active', 'pending_approval']);

    if (error) {
      this.logger.error('Failed to check institution admin count', { error, institutionId });
      throw new BadRequestException('Failed to verify admin capacity. Please try again.');
    }

    if ((count ?? 0) >= appConfig.INSTITUTION_MAX_ADMINS) {
      throw new ConflictException(
        `This institution has reached the maximum of ${appConfig.INSTITUTION_MAX_ADMINS} admins`,
      );
    }
  }

  // ── Personas: switch ─────────────────────────────────────────────────────

  /**
   * Switches the caller's active persona. SPEC.md §6.1: "Switching persona
   * is instant — no re-login required" — this only updates
   * profiles.active_persona; it never touches JWTs or sessions (the access
   * token doesn't carry a persona claim, so nothing needs reissuing).
   */
  async switchPersona(
    userId: string,
    dto: SwitchPersonaDto,
    req?: Request,
  ): Promise<{ activePersona: PersonaType }> {
    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('active_persona')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new NotFoundException('Profile not found');
    }

    const from = profile.active_persona as PersonaType;
    const to = dto.type;

    if (from === to) {
      // Idempotent — nothing changed, so nothing to write or audit.
      return { activePersona: to };
    }

    // Must own an ACTIVE persona of the target type. This is also the
    // mechanism that makes "school_admin can't self-approve" unbreakable
    // from this endpoint: a pending_approval school_admin persona simply
    // will not be found here, no matter how many times the client retries.
    const { data: target } = await this.supabase
      .from('personas')
      .select('id, status')
      .eq('user_id', userId)
      .eq('type', to)
      .eq('status', 'active')
      .maybeSingle();

    if (!target) {
      throw new ForbiddenException(
        `You do not have an active ${to} persona. It may not exist yet, or may still be pending approval.`,
      );
    }

    const { error: updateError } = await this.supabase
      .from('profiles')
      .update({ active_persona: to })
      .eq('id', userId);

    if (updateError) {
      this.logger.error('Failed to switch active persona', { error: updateError, userId });
      throw new BadRequestException('Failed to switch persona. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.PERSONA_SWITCHED,
      actorId: userId,
      targetId: userId,
      targetType: 'user',
      metadata: { from, to },
      req,
    });

    return { activePersona: to };
  }

  // ── LinkedIn (profile enrichment) ────────────────────────────────────────

  /** Saves only whichever of name/avatar the user explicitly checked — see SaveLinkedinDto's own comment. */
  async saveLinkedin(userId: string, dto: SaveLinkedinDto) {
    const patch: Record<string, unknown> = {
      linkedin_connected: true,
      linkedin_id: dto.linkedinId,
    };
    if (dto.confirmName && dto.name) patch.linkedin_name = dto.name;
    if (dto.confirmAvatar && dto.avatarUrl) patch.linkedin_avatar_url = dto.avatarUrl;

    const { data, error } = await this.supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select(
        'id, linkedinConnected:linkedin_connected, linkedinName:linkedin_name, linkedinAvatarUrl:linkedin_avatar_url',
      )
      .single();

    if (error || !data) {
      this.logger.error('Failed to save LinkedIn connection', { error, userId });
      throw new BadRequestException('Failed to save LinkedIn connection. Please try again.');
    }

    return data;
  }

  async disconnectLinkedin(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('profiles')
      .update({
        linkedin_connected: false,
        linkedin_id: null,
        linkedin_name: null,
        linkedin_avatar_url: null,
      })
      .eq('id', userId);

    if (error) {
      this.logger.error('Failed to disconnect LinkedIn', { error, userId });
      throw new BadRequestException('Failed to disconnect LinkedIn. Please try again.');
    }
  }
}
