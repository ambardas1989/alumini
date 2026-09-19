/**
 * AuthService — JWT issuance, Google OAuth, email/password auth, and
 * mandatory MFA (TOTP preferred, SMS fallback for non-admins).
 *
 * ARCHITECTURE
 * - Supabase Auth (auth.users) is the account/password store — we never
 *   hash or compare passwords ourselves, GoTrue does that. This service's
 *   own job is everything SPEC.md §4 asks for on top of that: the
 *   access/refresh token pair the rest of the API actually trusts, mandatory
 *   MFA enrolment and challenge, and concurrent-session limits.
 * - MFA is mandatory for everyone (appConfig.MFA_REQUIRED). A password or
 *   Google login that succeeds does NOT hand out a full session — it hands
 *   out a short-lived "pending" token (see auth.types.ts) that is only
 *   accepted by the /auth/mfa/* endpoints. Full access/refresh tokens are
 *   only issued once the MFA code is verified.
 * - School admins must use TOTP only (appConfig.ADMIN_MFA_TOTP_ONLY) — SMS
 *   setup is rejected before a challenge is ever created for them.
 *
 * AUDIT
 * Every method that changes auth state writes to audit_logs via AuditService
 * (SPEC.md §4.4 / §14.2) — login success/failure, MFA setup/success/failure/
 * challenge, session invalidation, logout, and token refresh.
 *
 * CONFIG
 * All tunable values (token lifetimes, rate limits, MFA rules) come from
 * appConfig (packages/config/app.ts) or brand (packages/config/brand.ts).
 * Secrets (JWT_SECRET, Google/Twilio credentials, Supabase keys) come from
 * process.env, matching the pattern already used by AuditService/ClassroomService.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomInt, randomUUID } from 'crypto';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AuditEventType, ErrorCode, MfaMethod, PersonaType } from '@alumini/types';
import { daysFromNow, isExpired } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';
import { brand } from '@alumini/config/brand';

import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { MfaSetupQueryDto } from './dto/mfa-setup-query.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaChallengeDto } from './dto/mfa-challenge.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { GoogleProfile } from './strategies/google.strategy';
import {
  AuthTokenPayload,
  AuthUserSummary,
  MfaRequiredResponse,
  MfaSetupSmsResponse,
  MfaSetupTotpResponse,
  MfaVerifiedResponse,
  TokenPairResponse,
} from './auth.types';

/** Outcome of a single MFA code check — see verifyCode() and mfaFailureException(). */
type MfaCodeCheckResult = 'valid' | 'invalid' | 'expired' | 'max_attempts';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly audit: AuditService,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    // Service role — bypasses RLS, same pattern as every other module.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Signup ───────────────────────────────────────────────────────────────

  /**
   * Creates a Supabase Auth user + profile (profile row is created by the
   * `handle_new_user` trigger in 001_initial_schema.sql). Does NOT return a
   * full session — MFA enrolment is mandatory and happens next.
   */
  async signup(dto: SignupDto, req?: Request): Promise<MfaRequiredResponse | TokenPairResponse> {
    const { data, error } = await this.supabase.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true, // no separate email-confirmation flow in this module's scope
      user_metadata: { full_name: dto.fullName },
    });

    if (error || !data.user) {
      // Supabase's own message ("User already registered", etc.) is safe to
      // surface — it doesn't leak anything an attacker couldn't already
      // learn by attempting the same signup themselves.
      throw new BadRequestException(error?.message ?? 'Could not create account');
    }

    this.logger.log(`Account created: ${data.user.id}`);

    if (!appConfig.MFA_REQUIRED) {
      return this.issueTokenPair(data.user.id, dto.email, req, { event: 'signup' });
    }

    const mfaPendingToken = await this.signToken(
      { sub: data.user.id, email: dto.email, purpose: 'mfa_setup' },
      this.minutes(appConfig.MFA_PENDING_TOKEN_EXPIRY_MINUTES),
    );

    return { mfaRequired: true, mfaPendingToken, mfaMethod: null };
  }

  // ── Login (email + password) ────────────────────────────────────────────

  async login(dto: LoginDto, req?: Request): Promise<MfaRequiredResponse | TokenPairResponse> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.user) {
      await this.audit.log({
        eventType: AuditEventType.AUTH_LOGIN_FAILURE,
        metadata: { email_domain: dto.email.split('@')[1] ?? null },
        req,
      });
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        error: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
    }

    return this.completePasswordVerifiedLogin(data.user.id, dto.email, req);
  }

  // ── Login (Google OAuth) ────────────────────────────────────────────────

  /**
   * Called by AuthController.googleCallback() once Passport has already
   * validated the OAuth handshake and extracted the Google profile.
   * Links to an existing account by email, or creates a new (passwordless)
   * one — Google has already verified the email address for us.
   */
  async loginWithGoogle(
    googleUser: GoogleProfile,
    req?: Request,
  ): Promise<MfaRequiredResponse | TokenPairResponse> {
    const { data: existing } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', googleUser.email)
      .maybeSingle();

    if (existing) {
      return this.completePasswordVerifiedLogin(existing.id, googleUser.email, req);
    }

    const { data, error } = await this.supabase.auth.admin.createUser({
      email: googleUser.email,
      email_confirm: true,
      user_metadata: { full_name: googleUser.fullName, avatar_url: googleUser.avatarUrl },
    });

    if (error || !data.user) {
      throw new BadRequestException(error?.message ?? 'Could not create account via Google');
    }

    this.logger.log(`Account created via Google: ${data.user.id}`);

    if (!appConfig.MFA_REQUIRED) {
      return this.issueTokenPair(data.user.id, googleUser.email, req, { event: 'signup', via: 'google' });
    }

    const mfaPendingToken = await this.signToken(
      { sub: data.user.id, email: googleUser.email, purpose: 'mfa_setup' },
      this.minutes(appConfig.MFA_PENDING_TOKEN_EXPIRY_MINUTES),
    );

    return { mfaRequired: true, mfaPendingToken, mfaMethod: null };
  }

  /**
   * Shared tail end of the password and Google login flows once the
   * identity itself is confirmed: decide whether this account still needs
   * to enrol in MFA, or just needs to pass an MFA challenge.
   */
  private async completePasswordVerifiedLogin(
    userId: string,
    email: string,
    req?: Request,
  ): Promise<MfaRequiredResponse | TokenPairResponse> {
    if (!appConfig.MFA_REQUIRED) {
      return this.issueTokenPair(userId, email, req);
    }

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('mfa_enabled, mfa_method')
      .eq('id', userId)
      .single();

    if (!profile?.mfa_enabled) {
      // Should be rare in practice — every signup is routed through mandatory
      // MFA setup — but covers accounts created before enforcement, or a
      // setup flow abandoned partway through.
      const mfaPendingToken = await this.signToken(
        { sub: userId, email, purpose: 'mfa_setup' },
        this.minutes(appConfig.MFA_PENDING_TOKEN_EXPIRY_MINUTES),
      );
      return { mfaRequired: true, mfaPendingToken, mfaMethod: null };
    }

    const mfaPendingToken = await this.signToken(
      { sub: userId, email, purpose: 'mfa_login' },
      this.minutes(appConfig.MFA_PENDING_TOKEN_EXPIRY_MINUTES),
    );

    return {
      mfaRequired: true,
      mfaPendingToken,
      mfaMethod: profile.mfa_method as MfaMethod,
    };
  }

  // ── MFA enrolment ────────────────────────────────────────────────────────

  /**
   * Starts (or restarts) MFA enrolment. Accepts either an mfa_setup pending
   * token (first-time enrolment, straight after signup/login) or a full
   * access token (an already-logged-in user adding/replacing their factor).
   */
  async initiateMfaSetup(
    userId: string,
    email: string,
    query: MfaSetupQueryDto,
  ): Promise<MfaSetupTotpResponse | MfaSetupSmsResponse> {
    const method = query.method ?? MfaMethod.TOTP;

    if (method === MfaMethod.SMS) {
      if (!appConfig.FEATURE_SMS_MFA) {
        throw new BadRequestException('SMS MFA is currently disabled');
      }
      if (appConfig.ADMIN_MFA_TOTP_ONLY && (await this.isSchoolAdmin(userId))) {
        throw new ForbiddenException(
          'School admins must use an authenticator app (TOTP) — SMS is not accepted',
        );
      }
      if (!query.phone) {
        throw new BadRequestException('Phone number is required for SMS MFA setup');
      }
      return this.initiateSmsChallenge(userId, query.phone);
    }

    return this.initiateTotpSetup(userId, email);
  }

  private async initiateTotpSetup(userId: string, email: string): Promise<MfaSetupTotpResponse> {
    const secret = speakeasy.generateSecret({
      name: `${brand.name} (${email})`,
      length: 20,
    });

    // Upsert — restarting setup before confirming replaces the previous,
    // still-unconfirmed secret rather than leaving an orphaned row behind.
    const { error } = await this.supabase.from('mfa_totp_secrets').upsert({
      user_id: userId,
      secret: secret.base32,
      confirmed: false,
      confirmed_at: null,
    });

    if (error) {
      this.logger.error('Failed to store TOTP secret', { error, userId });
      throw new BadRequestException('Failed to start MFA setup. Please try again.');
    }

    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url!);

    return { method: MfaMethod.TOTP, qrCodeDataUrl, secret: secret.base32 };
  }

  private async initiateSmsChallenge(userId: string, phone: string): Promise<MfaSetupSmsResponse> {
    const code = this.generateNumericCode(appConfig.SMS_OTP_LENGTH);
    const expiresAt = new Date(Date.now() + appConfig.SMS_OTP_EXPIRY_MINUTES * 60_000);

    const { error } = await this.supabase.from('mfa_sms_challenges').insert({
      user_id: userId,
      phone,
      code_hash: this.hash(code),
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      this.logger.error('Failed to store SMS challenge', { error, userId });
      throw new BadRequestException('Failed to start MFA setup. Please try again.');
    }

    // Actual delivery (Twilio credentials, message templates) belongs to the
    // notification module — auth only creates and validates the challenge,
    // consistent with how VerificationService hands off email OTP delivery.
    this.eventEmitter.emit('mfa.sms.send', { userId, phone, code });

    return {
      method: MfaMethod.SMS,
      phone: this.maskPhone(phone),
      expiresInSeconds: appConfig.SMS_OTP_EXPIRY_MINUTES * 60,
    };
  }

  /**
   * Confirms the code from initiateMfaSetup(), turns MFA on for the account,
   * and — since this always follows a signup or login that was waiting on
   * MFA — immediately issues the full session that was withheld until now.
   *
   * Response shape is intentionally narrower than the TokenPairResponse
   * every other session-issuing flow returns (no refreshToken) — this is
   * the shape the frontend's POST /auth/mfa/verify integration expects.
   */
  async completeMfaSetup(
    userId: string,
    email: string,
    dto: MfaVerifyDto,
    req?: Request,
  ): Promise<LoginResponseDto> {
    const result = await this.verifyCode(userId, dto.method, dto.code, { confirmSetup: true });

    if (result !== 'valid') {
      await this.audit.log({
        eventType: AuditEventType.AUTH_MFA_FAILURE,
        actorId: userId,
        metadata: { method: dto.method, stage: 'setup', reason: result },
        req,
      });
      throw this.mfaFailureException(result);
    }

    const { error } = await this.supabase
      .from('profiles')
      .update({ mfa_enabled: true, mfa_method: dto.method })
      .eq('id', userId);

    if (error) {
      this.logger.error('Failed to enable MFA on profile', { error, userId });
      throw new BadRequestException('Failed to complete MFA setup. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.AUTH_MFA_SETUP,
      actorId: userId,
      metadata: { method: dto.method },
      req,
    });

    const tokenPair = await this.issueTokenPair(userId, email, req, { event: 'mfa_setup_complete' });

    return {
      accessToken: tokenPair.accessToken,
      expiresAt: daysFromNow(appConfig.JWT_EXPIRY_DAYS).toISOString(),
      user: await this.loadLoginResponseUser(userId, email),
    };
  }

  // ── MFA challenge (login completion + sensitive-action re-auth) ────────

  /**
   * Verifies an MFA code for an account that already has MFA enabled.
   *
   * - `authToken.purpose === 'mfa_login'` → this completes a login started
   *   by login()/loginWithGoogle(); a full session is issued.
   * - Any other purpose (in practice, a normal 'access' token) → this is a
   *   sensitive-action re-challenge (SPEC.md §11.2, §6.2) for an already
   *   logged-in user. No new tokens are issued; the caller just gets
   *   confirmation that the second factor was proven again just now.
   */
  async challengeMfa(
    authToken: AuthTokenPayload,
    dto: MfaChallengeDto,
    req?: Request,
  ): Promise<TokenPairResponse | MfaVerifiedResponse> {
    const userId = authToken.sub;

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('mfa_method, email')
      .eq('id', userId)
      .single();

    const method = dto.method ?? (profile?.mfa_method as MfaMethod | undefined);
    if (!method) {
      throw new BadRequestException('No MFA method is configured for this account');
    }

    const result = await this.verifyCode(userId, method, dto.code, { confirmSetup: false });

    if (result !== 'valid') {
      await this.audit.log({
        eventType: AuditEventType.AUTH_MFA_FAILURE,
        actorId: userId,
        metadata: { method, purpose: authToken.purpose, reason: result },
        req,
      });
      throw this.mfaFailureException(result);
    }

    await this.audit.log({
      eventType: AuditEventType.AUTH_MFA_SUCCESS,
      actorId: userId,
      metadata: { method, purpose: authToken.purpose },
      req,
    });

    if (authToken.purpose === 'mfa_login') {
      return this.issueTokenPair(userId, profile?.email ?? authToken.email ?? '', req, {
        event: 'mfa_challenge_login',
      });
    }

    // Sensitive-action re-challenge — record it distinctly from a plain
    // MFA success so admin audit views can tell the two apart.
    await this.audit.log({
      eventType: AuditEventType.AUTH_MFA_CHALLENGE,
      actorId: userId,
      metadata: { method },
      req,
    });

    return { verified: true };
  }

  /**
   * Checks a submitted code against the account's stored TOTP secret or
   * latest unconsumed SMS challenge.
   *
   * @param opts.confirmSetup - true only when called from completeMfaSetup():
   *   allows validating against an unconfirmed TOTP secret, and marks it
   *   confirmed on success. Every other caller must fail against an
   *   unconfirmed secret — an in-progress re-enrolment should never be
   *   usable to complete a login or a sensitive-action re-challenge.
   */
  private async verifyCode(
    userId: string,
    method: MfaMethod,
    code: string,
    opts: { confirmSetup: boolean },
  ): Promise<MfaCodeCheckResult> {
    if (method === MfaMethod.TOTP) {
      const { data: record } = await this.supabase
        .from('mfa_totp_secrets')
        .select('secret, confirmed')
        .eq('user_id', userId)
        .maybeSingle();

      if (!record) return 'invalid';
      if (!opts.confirmSetup && !record.confirmed) return 'invalid';

      const isValid = speakeasy.totp.verify({
        secret: record.secret,
        encoding: 'base32',
        token: code,
        // ±2 time-steps (60s) of clock drift. This was ±1 (30s) — widened
        // after reports of fresh codes still being rejected, which a ±30s
        // window doesn't cover if the drift itself is larger than that. If
        // codes are still rejected after this, the step-window isn't the
        // real cause — check the server's actual clock (Render instance
        // time) and whether the authenticator app in question (e.g. PingID)
        // uses a non-default step interval or digit count, since speakeasy
        // assumes the RFC 6238 defaults (30s step, 6 digits) on both ends.
        window: 2,
      });

      if (isValid && opts.confirmSetup) {
        await this.supabase
          .from('mfa_totp_secrets')
          .update({ confirmed: true, confirmed_at: new Date().toISOString() })
          .eq('user_id', userId);
      }

      return isValid ? 'valid' : 'invalid';
    }

    // SMS — check against the most recent unconsumed, unexpired challenge.
    const { data: challenge } = await this.supabase
      .from('mfa_sms_challenges')
      .select('id, code_hash, expires_at, consumed, attempts')
      .eq('user_id', userId)
      .eq('consumed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!challenge) return 'invalid';
    if (isExpired(challenge.expires_at)) return 'expired';
    if (challenge.attempts >= appConfig.RATE_LIMIT_MFA_PER_MIN) return 'max_attempts';

    const matches = challenge.code_hash === this.hash(code);

    await this.supabase
      .from('mfa_sms_challenges')
      .update({ attempts: challenge.attempts + 1, consumed: matches })
      .eq('id', challenge.id);

    return matches ? 'valid' : 'invalid';
  }

  /** Maps a non-'valid' verifyCode() result to the matching structured ErrorCode. */
  private mfaFailureException(result: Exclude<MfaCodeCheckResult, 'valid'>): UnauthorizedException {
    switch (result) {
      case 'expired':
        return new UnauthorizedException({
          message: 'This code has expired. Please request a new one.',
          error: ErrorCode.AUTH_MFA_EXPIRED,
        });
      case 'max_attempts':
        return new UnauthorizedException({
          message: 'Too many incorrect attempts. Please request a new code.',
          error: ErrorCode.AUTH_MFA_MAX_ATTEMPTS,
        });
      default:
        return new UnauthorizedException({
          message: 'Incorrect verification code',
          error: ErrorCode.AUTH_MFA_INVALID_CODE,
        });
    }
  }

  // ── Session management ───────────────────────────────────────────────────

  /**
   * Exchanges a refresh token for a new access + refresh pair (rotation —
   * the old refresh token is immediately replaced so a leaked-but-unused
   * one stops working the moment the legitimate client refreshes).
   */
  async refreshTokens(dto: RefreshTokenDto, req?: Request): Promise<TokenPairResponse> {
    let payload: AuthTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AuthTokenPayload>(dto.refreshToken, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException({
        message: 'Invalid or expired refresh token',
        error: ErrorCode.AUTH_SESSION_EXPIRED,
      });
    }

    if (payload.purpose !== 'refresh' || !payload.sessionId) {
      throw new UnauthorizedException('Not a refresh token');
    }

    const { data: session } = await this.supabase
      .from('sessions')
      .select('id, user_id, revoked_at, expires_at')
      .eq('id', payload.sessionId)
      .eq('refresh_token_hash', this.hash(dto.refreshToken))
      .maybeSingle();

    if (!session || session.revoked_at || isExpired(session.expires_at)) {
      throw new UnauthorizedException({
        message: 'Session is no longer valid. Please log in again.',
        error: ErrorCode.AUTH_SESSION_EXPIRED,
      });
    }

    const accessToken = await this.signToken(
      { sub: payload.sub, email: payload.email, purpose: 'access', sessionId: session.id },
      this.minutes(appConfig.JWT_ACCESS_EXPIRY_MINUTES),
    );
    const newRefreshToken = await this.signToken(
      { sub: payload.sub, email: payload.email, purpose: 'refresh', sessionId: session.id },
      this.days(appConfig.JWT_EXPIRY_DAYS),
    );

    await this.supabase
      .from('sessions')
      .update({
        refresh_token_hash: this.hash(newRefreshToken),
        last_used_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    await this.audit.log({
      eventType: AuditEventType.AUTH_TOKEN_REFRESHED,
      actorId: session.user_id,
      metadata: { session_id: session.id },
      req,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: appConfig.JWT_ACCESS_EXPIRY_MINUTES * 60,
      user: await this.loadUserSummary(session.user_id, payload.email ?? ''),
    };
  }

  /** Revokes the current session (or, with allDevices, every session) for the caller. */
  async logout(authToken: AuthTokenPayload, dto: LogoutDto, req?: Request): Promise<void> {
    const userId = authToken.sub;

    if (dto.allDevices) {
      await this.supabase
        .from('sessions')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_logout_all' })
        .eq('user_id', userId)
        .is('revoked_at', null);
    } else if (authToken.sessionId) {
      await this.supabase
        .from('sessions')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_logout' })
        .eq('id', authToken.sessionId)
        .eq('user_id', userId);
    }

    await this.audit.log({
      eventType: AuditEventType.AUTH_LOGOUT,
      actorId: userId,
      metadata: { all_devices: !!dto.allDevices },
      req,
    });
  }

  // ── Internal: token issuance ─────────────────────────────────────────────

  /**
   * Mints a fresh access/refresh pair, persists the session row, and audits
   * AUTH_LOGIN_SUCCESS. Called from every flow that ends in a full session:
   * signup/login with MFA disabled, MFA setup completion, and MFA challenge
   * completion.
   */
  private async issueTokenPair(
    userId: string,
    email: string,
    req?: Request,
    auditMetadata: Record<string, unknown> = {},
  ): Promise<TokenPairResponse> {
    await this.enforceDeviceLimit(userId, req);

    const sessionId = randomUUID();

    const accessToken = await this.signToken(
      { sub: userId, email, purpose: 'access', sessionId },
      this.minutes(appConfig.JWT_ACCESS_EXPIRY_MINUTES),
    );
    const refreshToken = await this.signToken(
      { sub: userId, email, purpose: 'refresh', sessionId },
      this.days(appConfig.JWT_EXPIRY_DAYS),
    );

    const { error } = await this.supabase.from('sessions').insert({
      id: sessionId,
      user_id: userId,
      refresh_token_hash: this.hash(refreshToken),
      user_agent: (req?.headers['user-agent'] as string) ?? null,
      ip_address: this.extractIp(req) ?? null,
      expires_at: daysFromNow(appConfig.JWT_EXPIRY_DAYS).toISOString(),
    });

    if (error) {
      this.logger.error('Failed to create session record', { error, userId });
      throw new BadRequestException('Failed to complete sign-in. Please try again.');
    }

    await this.audit.log({
      eventType: AuditEventType.AUTH_LOGIN_SUCCESS,
      actorId: userId,
      metadata: { session_id: sessionId, ...auditMetadata },
      req,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: appConfig.JWT_ACCESS_EXPIRY_MINUTES * 60,
      user: await this.loadUserSummary(userId, email),
    };
  }

  /**
   * SPEC.md §4.3: "Concurrent session limit: 5 devices per account."
   * Evicts the oldest active session(s) so the new login fits under the cap,
   * rather than rejecting the new login outright.
   */
  private async enforceDeviceLimit(userId: string, req?: Request): Promise<void> {
    const { data: activeSessions } = await this.supabase
      .from('sessions')
      .select('id, created_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (!activeSessions || activeSessions.length < appConfig.SESSION_MAX_DEVICES) {
      return;
    }

    const overflow = activeSessions.length - appConfig.SESSION_MAX_DEVICES + 1;
    const toEvict = activeSessions.slice(0, overflow);

    await this.supabase
      .from('sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'device_limit_exceeded' })
      .in('id', toEvict.map((s) => s.id));

    await this.audit.log({
      eventType: AuditEventType.AUTH_SESSION_INVALIDATED,
      actorId: userId,
      metadata: { reason: 'device_limit_exceeded', evicted_count: toEvict.length },
      req,
    });
  }

  // ── Internal: small helpers ──────────────────────────────────────────────

  private async isSchoolAdmin(userId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', userId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .maybeSingle();

    return !!data;
  }

  private async loadUserSummary(userId: string, fallbackEmail: string): Promise<AuthUserSummary> {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id, email, full_name, mfa_enabled')
      .eq('id', userId)
      .single();

    return {
      id: profile?.id ?? userId,
      email: profile?.email ?? fallbackEmail,
      fullName: profile?.full_name ?? '',
      mfaEnabled: profile?.mfa_enabled ?? false,
    };
  }

  /** User shape for LoginResponseDto (POST /auth/mfa/verify) — see completeMfaSetup(). */
  private async loadLoginResponseUser(userId: string, fallbackEmail: string) {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, active_persona')
      .eq('id', userId)
      .single();

    return {
      id: profile?.id ?? userId,
      email: profile?.email ?? fallbackEmail,
      fullName: profile?.full_name ?? '',
      avatarUrl: profile?.avatar_url ?? null,
      activePersona: profile?.active_persona ?? PersonaType.ALUMNI,
    };
  }

  private async signToken(payload: AuthTokenPayload, expiresIn: string): Promise<string> {
    return this.jwtService.signAsync(payload, { secret: process.env.JWT_SECRET, expiresIn });
  }

  /** One-way hash for values we store but never need to reverse (refresh tokens, OTP codes). */
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private generateNumericCode(length: number): string {
    const max = 10 ** length;
    return randomInt(0, max).toString().padStart(length, '0');
  }

  /** e.g. +919876543210 → +9********210 — enough for the user to recognise their own number */
  private maskPhone(phone: string): string {
    if (phone.length <= 5) return '*'.repeat(phone.length);
    return phone.slice(0, 2) + '*'.repeat(phone.length - 5) + phone.slice(-3);
  }

  private extractIp(req?: Request): string | undefined {
    return req
      ? ((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
          req.socket?.remoteAddress)
      : undefined;
  }

  private minutes(n: number): string {
    return `${n}m`;
  }

  private days(n: number): string {
    return `${n}d`;
  }
}
