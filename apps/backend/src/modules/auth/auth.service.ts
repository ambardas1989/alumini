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
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { EmailService } from '../../common/email/email.service';
import { AuditEventType, ErrorCode, MfaMethod, PersonaType } from '@alumini/types';
import { daysFromNow, isExpired, minutesFromNow } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';
import { brand } from '@alumini/config/brand';

import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MfaResetDevDto } from './dto/mfa-reset-dev.dto';
import { MfaRecoveryRequestDto } from './dto/mfa-recovery-request.dto';
import { MfaRecoveryVerifyDto } from './dto/mfa-recovery-verify.dto';
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
  MfaSetupEmailResponse,
  MfaSetupSmsResponse,
  MfaSetupTotpResponse,
  MfaVerifiedResponse,
  TokenPairResponse,
} from './auth.types';

/** email_otp_codes.purpose — see supabase/migrations/018_email_otp_mfa.sql. */
export type EmailOtpPurpose = 'login' | 'password_reset' | 'mfa_change';

/**
 * BUG FIX — used by AuthController.mfaEmailResend() to derive which
 * email_otp_codes.purpose a resend belongs to from the pending/access
 * token's OWN `purpose` claim (TokenPurpose, a different type — access/
 * refresh/mfa_setup/mfa_login — from EmailOtpPurpose above). Only a
 * completed login's own MFA step ('mfa_login') maps to 'login'; every
 * other token purpose reaching that endpoint means setup or an
 * already-logged-in user switching methods (a real 'access' token, not
 * 'mfa_setup') — both cases must resend under 'mfa_change', matching
 * whatever initiateMfaSetup()'s email branch originally sent under.
 * Extracted as its own pure function (previously an inline ternary in the
 * controller) so this exact mapping has real unit-test coverage — this
 * codebase has no controller-level test file for any module, service-level
 * is the established convention throughout.
 */
export function resendPurposeFor(tokenPurpose: AuthTokenPayload['purpose']): EmailOtpPurpose {
  return tokenPurpose === 'mfa_login' ? 'login' : 'mfa_change';
}

/** Outcome of a single MFA code check — see verifyCode() and mfaFailureException(). */
type MfaCodeCheckResult = 'valid' | 'invalid' | 'expired' | 'max_attempts';

/** connectLinkedin()'s return shape — see its own doc comment for why this is only 3 fields. */
export interface LinkedinConnectData {
  linkedinId: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Same pattern as google.strategy.ts's isGoogleOAuthConfigured(). */
export function isLinkedInOAuthConfigured(): boolean {
  return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(
    private readonly audit: AuditService,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
    appLogger: AppLogger,
    private readonly emailService: EmailService,
  ) {
    this.appLogger = appLogger.setContext('AUTH');
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
    this.appLogger.debug('[AUTH:signup] entry', { email: AppLogger.maskEmail(dto.email), fullName: dto.fullName });
    this.appLogger.debug('[AUTH:signup] creating auth user', { email: AppLogger.maskEmail(dto.email) });

    const { data, error } = await this.supabase.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true, // no separate email-confirmation flow in this module's scope
      user_metadata: { full_name: dto.fullName },
    });

    if (error || !data.user) {
      // BUG FIX (TASKS_05 TASK 09) — this always threw a plain
      // BadRequestException (400) regardless of WHY Supabase rejected the
      // signup, including the single most common real case: the email is
      // already registered. The frontend's getErrorMessage() treats every
      // unmapped 400 as the generic "Something went wrong" fallback — so
      // signing up with an email that already has an account looked
      // exactly like an unexplained failure, which is what the bug report
      // actually was. Supabase's own message ("User already registered",
      // etc.) is safe to surface either way — it doesn't leak anything an
      // attacker couldn't already learn by attempting the same signup
      // themselves — but a duplicate email now gets its own 409 with a
      // structured error code the frontend can branch on.
      const isDuplicate = /already registered|already exists|user_already_exists|email_exists/i.test(
        error?.message ?? error?.code ?? '',
      );
      this.appLogger.error('[AUTH:signup] failed', {
        email: AppLogger.maskEmail(dto.email),
        error: error?.message,
        code: (error as { code?: string } | null)?.code,
        hint: (error as { hint?: string } | null)?.hint,
        details: (error as { details?: string } | null)?.details,
        stack: undefined,
      });
      if (isDuplicate) {
        throw new ConflictException({
          message: 'An account with this email already exists',
          error: ErrorCode.AUTH_ACCOUNT_EXISTS,
        });
      }
      throw new BadRequestException(error?.message ?? 'Could not create account');
    }

    this.logger.log(`Account created: ${data.user.id}`);
    // Profile row itself is created by the handle_new_user DB trigger, not this method.
    this.appLogger.debug('[AUTH:signup] profile created via trigger', { userId: data.user.id });
    await this.emailService.sendWelcome(dto.email, dto.fullName);

    if (!appConfig.MFA_REQUIRED) {
      this.appLogger.info('[AUTH:signup] success', { userId: data.user.id, mfaRequired: false });
      return this.issueTokenPair(data.user.id, dto.email, req, { event: 'signup' });
    }

    const mfaPendingToken = await this.signToken(
      { sub: data.user.id, email: dto.email, purpose: 'mfa_setup' },
      this.minutes(appConfig.MFA_PENDING_TOKEN_EXPIRY_MINUTES),
    );

    this.appLogger.info('[AUTH:signup] success', { userId: data.user.id, mfaRequired: true });
    return { mfaRequired: true, mfaPendingToken, mfaMethod: null };
  }

  // ── Login (email + password) ────────────────────────────────────────────

  async login(dto: LoginDto, req?: Request): Promise<MfaRequiredResponse | TokenPairResponse> {
    this.appLogger.debug('[AUTH:login] entry', { email: AppLogger.maskEmail(dto.email) });

    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    this.appLogger.debug('[AUTH:login] user lookup result', { found: !!data.user });

    if (error || !data.user) {
      this.appLogger.warn('[AUTH:login] failed', { email: AppLogger.maskEmail(dto.email), reason: 'invalid_credentials' });
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

    this.appLogger.debug('[AUTH:login] password check', { valid: true });
    this.appLogger.info('[AUTH:login] success', { userId: data.user.id });
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

  // ── LinkedIn connect (profile enrichment, NOT login) ─────────────────────

  /**
   * TASKS_05 TASK 06 — SCOPED DOWN from the task's original spec. LinkedIn's
   * standard consumer OAuth (the 'openid profile email' scopes any
   * registered app can request) only returns name/email/profile-photo —
   * it does NOT return headline, positions, educations, or location. Those
   * fields require LinkedIn's Marketing/Talent Partner Program, a business
   * approval process this codebase has no access to. Rather than fabricate
   * that data, this only ever requests and stores what LinkedIn's OAuth
   * actually hands back: linkedinId (the 'sub' claim), name, avatarUrl.
   * There is deliberately no sync()/recommendations() companion to this —
   * both depended entirely on the job/education data that was dropped.
   *
   * Uses plain fetch() against LinkedIn's OAuth/OIDC REST endpoints instead
   * of a passport strategy — this is a "connect an already-logged-in
   * account" action, not a login flow, so there's no Passport session to
   * carry the caller's identity through a browser redirect anyway; the
   * frontend does the initial redirect to LinkedIn itself (client_id is
   * public) and calls this method with the resulting `code` over a normal,
   * already-authenticated fetch. No new dependency needed for two REST calls.
   */
  async connectLinkedin(code: string, redirectUri: string): Promise<LinkedinConnectData> {
    if (!isLinkedInOAuthConfigured()) {
      throw new BadRequestException('LinkedIn connect is not available');
    }

    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID!,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
      }),
    });

    if (!tokenRes.ok) {
      this.logger.error('LinkedIn token exchange failed', { status: tokenRes.status });
      throw new BadRequestException('Could not connect to LinkedIn. Please try again.');
    }

    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      this.logger.error('LinkedIn userinfo fetch failed', { status: profileRes.status });
      throw new BadRequestException('Could not read your LinkedIn profile. Please try again.');
    }

    const profile = (await profileRes.json()) as { sub: string; name?: string; picture?: string };

    return {
      linkedinId: profile.sub,
      name: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
    };
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

    this.appLogger.debug('[AUTH:login] mfa method', { userId, mfaMethod: profile.mfa_method });

    // Email OTP has to be sent proactively — unlike TOTP (the app already
    // has a live code) or SMS (its own initiateSmsChallenge() is only ever
    // called from the setup flow, not login — an existing gap this task
    // doesn't touch), there's no code waiting anywhere until this fires.
    if (profile.mfa_method === MfaMethod.EMAIL) {
      await this.sendEmailOtp(userId, email, 'login');
    }

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
  ): Promise<MfaSetupTotpResponse | MfaSetupSmsResponse | MfaSetupEmailResponse> {
    const method = query.method ?? MfaMethod.EMAIL;
    this.appLogger.info('MFA setup initiated', { userId, method });

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

    if (method === MfaMethod.EMAIL) {
      if (appConfig.ADMIN_MFA_TOTP_ONLY && (await this.isSchoolAdmin(userId))) {
        throw new ForbiddenException(
          'School admins must use an authenticator app (TOTP) — email is not accepted',
        );
      }
      await this.sendEmailOtp(userId, email, 'mfa_change');
      return {
        method: MfaMethod.EMAIL,
        email: this.maskEmail(email),
        expiresInSeconds: appConfig.MFA_EMAIL_OTP_EXPIRY_MINUTES * 60,
      };
    }

    return this.initiateTotpSetup(userId, email);
  }

  private async initiateTotpSetup(userId: string, email: string): Promise<MfaSetupTotpResponse> {
    this.appLogger.debug('[AUTH:totpSetup] entry', { userId });
    this.appLogger.debug('[AUTH:totpSetup] generating secret', { userId });
    const secret = speakeasy.generateSecret({
      name: `${brand.name} (${email})`,
      length: 20,
    });

    // Upsert — restarting setup before confirming replaces the previous,
    // still-unconfirmed secret rather than leaving an orphaned row behind.
    this.appLogger.debug('[AUTH:totpSetup] storing secret', { userId });
    const { error } = await this.supabase.from('mfa_totp_secrets').upsert({
      user_id: userId,
      secret: secret.base32,
      confirmed: false,
      confirmed_at: null,
    });

    this.appLogger.debug('[AUTH:totpSetup] db result', {
      success: !error,
      error: error?.message,
      code: (error as { code?: string } | null)?.code,
    });

    if (error) {
      // TASKS_05 TASK 10 Fix 2 — the previous log here (`{ error, userId }`)
      // relied on the logger's default object formatting to surface
      // Postgres's own code/details/hint, which doesn't reliably happen —
      // Nest's default console logger often prints an Error-like object as
      // just its message. Pulled out explicitly so a real failure is
      // actually diagnosable from Render logs instead of just this generic
      // 400 the client sees.
      this.appLogger.error('[AUTH:totpSetup] failed', {
        userId,
        error: error?.message,
        code: (error as { code?: string }).code,
        hint: (error as { hint?: string }).hint,
        details: (error as { details?: string }).details,
      });
      throw new BadRequestException('Failed to start MFA setup. Please try again.');
    }

    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url!);

    this.appLogger.info('[AUTH:totpSetup] success', { userId });
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

  // ── Email OTP (MFA) ──────────────────────────────────────────────────────

  /**
   * Generates, hashes, and stores a 6-digit code, then emails it via
   * EmailService (not the notification module's event-based delivery:
   * mfa.sms.send above proves an emitted event with no listener silently
   * drops the code, and this needs to actually work).
   */
  async sendEmailOtp(userId: string, email: string, purpose: EmailOtpPurpose): Promise<{ message: string }> {
    this.appLogger.debug('[AUTH:sendOtp] entry', { userId, purpose });

    const windowStart = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count, error: countError } = await this.supabase
      .from('email_otp_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('purpose', purpose)
      .gte('created_at', windowStart);

    this.appLogger.debug('[AUTH:sendOtp] rate limit query result', { count, error: countError?.message });

    if (countError) {
      this.appLogger.error('[AUTH:sendOtp] failed', {
        userId,
        purpose,
        error: countError.message,
        code: countError.code,
        hint: countError.hint,
        details: countError.details,
      });
      throw new BadRequestException('Failed to send code. Please try again.');
    }

    if ((count ?? 0) >= appConfig.MFA_EMAIL_OTP_RATE_LIMIT_PER_10MIN) {
      this.appLogger.warn('[AUTH:sendOtp] rate limited', { userId, purpose, count });
      throw new BadRequestException('Too many codes requested. Please wait a few minutes and try again.');
    }

    this.appLogger.debug('[AUTH:sendOtp] generating code', { userId });
    const code = this.generateNumericCode(appConfig.MFA_EMAIL_OTP_LENGTH);
    const codeHash = this.hash(code);
    // Never logs the raw code — only enough of the hash to eyeball-correlate
    // between a send and the matching verify attempt in Render logs.
    this.appLogger.debug('[AUTH:sendOtp] code generated', { userId, hashPrefix: codeHash.slice(0, 20) });
    const expiresAt = new Date(Date.now() + appConfig.MFA_EMAIL_OTP_EXPIRY_MINUTES * 60_000);

    // Invalidate any still-unused codes from an earlier send for this same
    // user+purpose before issuing a new one — checkEmailOtp() already only
    // ever checks the LATEST unused row, so an old row sitting around isn't
    // a verification hazard by itself, but it does mean a user who received
    // two emails (a resend, a double-fired request) and types the older
    // still-valid-looking code from their inbox gets a confusing mismatch
    // against whichever row is newest. Only one unused code should exist
    // per user+purpose at a time. Not a hard failure if this delete errors —
    // the new code below is still correct and usable either way.
    this.appLogger.debug('[AUTH:sendOtp] deleting old codes', { userId, purpose });
    const { error: cleanupError } = await this.supabase
      .from('email_otp_codes')
      .delete()
      .eq('user_id', userId)
      .eq('purpose', purpose)
      .eq('used', false);

    if (cleanupError) {
      this.appLogger.error('[AUTH:sendOtp] cleanup failed', {
        userId,
        purpose,
        error: cleanupError.message,
        code: cleanupError.code,
        hint: cleanupError.hint,
        details: cleanupError.details,
      });
    }

    this.appLogger.debug('[AUTH:sendOtp] inserting to db', { userId, purpose, expiresAt: expiresAt.toISOString() });
    const { error } = await this.supabase.from('email_otp_codes').insert({
      user_id: userId,
      code_hash: codeHash,
      purpose,
      expires_at: expiresAt.toISOString(),
    });

    this.appLogger.debug('[AUTH:sendOtp] db insert result', { success: !error, error: error?.message });

    if (error) {
      this.appLogger.error('[AUTH:sendOtp] failed', {
        userId,
        purpose,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to send code. Please try again.');
    }

    await this.emailService.sendOtpCode(email, code, purpose);

    this.appLogger.info('[AUTH:sendOtp] sent', { userId, purpose, email: AppLogger.maskEmail(email) });
    return { message: 'Code sent to your email' };
  }

  /**
   * Same shape as verifyCode()'s SMS branch (which calls this directly for
   * its own 'email' case): newest unconsumed, unexpired code for this
   * user+purpose, attempt-capped, hash-compared, marked used either way (a
   * wrong guess still counts against the attempt cap).
   */
  /**
   * @param consume - TASKS_07 TASK 04. Defaults true (preserves every
   *   existing call site's behaviour). false is a non-consuming "peek" —
   *   still increments `attempts` (so it counts toward the same brute-force
   *   cap a real check would, closing off using peek as a free guessing
   *   oracle) but never sets `used`, so a correct code stays valid for a
   *   SUBSEQUENT real check to consume. Exists for the change-password
   *   modal's two-step UI: Step 1 needs real, immediate pass/fail feedback
   *   on the code the user just typed, but the modal's actual password
   *   change (Step 2) is a single combined verify+act request against
   *   POST /auth/change-password (see MfaChallengeGuard) — if Step 1
   *   consumed the code, Step 2's re-submission of that same code would
   *   always fail as "already used", even though it was correct.
   */
  private async checkEmailOtp(
    userId: string,
    code: string,
    purpose: EmailOtpPurpose,
    consume: boolean = true,
  ): Promise<MfaCodeCheckResult> {
    const computedHash = this.hash(code);
    // Never logs the raw submitted code — only enough of the hash to
    // eyeball-correlate against sendEmailOtp()'s own hashPrefix log.
    this.appLogger.debug('[AUTH:checkOtp] entry', { userId, purpose, codeLength: code?.length, codeType: typeof code });
    this.appLogger.debug('[AUTH:checkOtp] computing hash', { hashPrefix: computedHash.slice(0, 20) });
    this.appLogger.debug('[AUTH:checkOtp] query params', { userId, purpose, hashPrefix: computedHash.slice(0, 20) });

    const { data: challenge, error } = await this.supabase
      .from('email_otp_codes')
      .select('id, purpose, code_hash, attempts, used, expires_at')
      .eq('user_id', userId)
      .eq('purpose', purpose)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    this.appLogger.debug('[AUTH:checkOtp] query result', {
      found: !!challenge,
      rowPurpose: challenge?.purpose ?? null,
      rowUsed: challenge?.used ?? null,
      rowExpired: challenge ? isExpired(challenge.expires_at) : null,
      rowHashPrefix: challenge?.code_hash?.slice(0, 20) ?? null,
      hashMatch: challenge ? challenge.code_hash === computedHash : null,
      dbError: error?.message,
      dbCode: error?.code,
      dbHint: error?.hint,
    });

    if (error) {
      this.appLogger.error('[AUTH:checkOtp] db error', {
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      return 'invalid';
    }

    if (!challenge) {
      this.appLogger.warn('[AUTH:checkOtp] not found', { userId, purpose });
      return 'invalid';
    }
    if (isExpired(challenge.expires_at)) {
      this.appLogger.warn('[AUTH:checkOtp] expired', { userId, purpose });
      return 'expired';
    }
    if (challenge.attempts >= appConfig.MFA_EMAIL_OTP_RATE_LIMIT_PER_10MIN) {
      this.appLogger.warn('[AUTH:checkOtp] max attempts', { userId, purpose });
      return 'max_attempts';
    }

    const matches = challenge.code_hash === computedHash;
    const shouldMarkUsed = matches && consume;

    await this.supabase
      .from('email_otp_codes')
      .update({
        attempts: challenge.attempts + 1,
        used: shouldMarkUsed,
        used_at: shouldMarkUsed ? new Date().toISOString() : null,
      })
      .eq('id', challenge.id);

    if (matches) {
      this.appLogger.info('[AUTH:checkOtp] verified', { userId, purpose });
    } else {
      this.appLogger.warn('[AUTH:checkOtp] hash mismatch', { userId, purpose });
    }

    return matches ? 'valid' : 'invalid';
  }

  /** Public, throwing wrapper around checkEmailOtp() — for direct callers outside the MFA challenge dispatcher, e.g. the password-reset flow. */
  async verifyEmailOtp(userId: string, code: string, purpose: EmailOtpPurpose): Promise<boolean> {
    const result = await this.checkEmailOtp(userId, code, purpose);
    if (result !== 'valid') {
      throw new UnauthorizedException('Invalid or expired code');
    }
    return true;
  }

  async resendEmailOtp(userId: string, email: string, purpose: EmailOtpPurpose): Promise<{ message: string }> {
    await this.sendEmailOtp(userId, email, purpose);
    return { message: 'Code resent' };
  }

  /** e.g. test@example.com → te***@example.com — enough for the user to recognise their own address */
  private maskEmail(email: string): string {
    const [user, domain] = email.split('@');
    if (!domain || !user) return '***';
    return user.slice(0, 2) + '***@' + domain;
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
      this.appLogger.error('MFA verify failed', { userId, reason: result });
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

    this.appLogger.info('MFA verified', { userId, method: dto.method });
    await this.audit.log({
      eventType: AuditEventType.AUTH_MFA_SETUP,
      actorId: userId,
      metadata: { method: dto.method },
      req,
    });

    const tokenPair = await this.issueTokenPair(userId, email, req, { event: 'mfa_setup_complete' });

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      // BUG FIX (TASKS_03 TASK 02): this used to be daysFromNow(JWT_EXPIRY_DAYS)
      // — the REFRESH token's multi-day lifetime, not the access token's
      // real 15-minute one. The frontend stores this value as "when to
      // silently refresh" (lib/auth.ts's shouldRefreshToken()); with a
      // multi-day expiry on file, it never even tried until the access
      // token had ALREADY been dead — by real JWT expiry, unnoticed by the
      // client — for potentially days, so the next API call's 401 always
      // looked like an out-of-the-blue "session expired".
      expiresAt: minutesFromNow(appConfig.JWT_ACCESS_EXPIRY_MINUTES).toISOString(),
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
  ): Promise<LoginResponseDto | MfaVerifiedResponse> {
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

    // TASKS_07 TASK 04 — dto.peek lets a caller get a real pass/fail check
    // without consuming the code, for a UI that needs to verify a code
    // "now" but still submit that SAME code again for the real action
    // later (see checkEmailOtp()'s own doc comment on `consume`). Login
    // completion (mfa_login) must ALWAYS consume — it's a one-time state
    // transition (issuing a session), never re-checked afterward — so
    // peek is force-disabled for that case regardless of what the caller
    // asked for.
    const consume = authToken.purpose === 'mfa_login' ? true : !dto.peek;

    // BUG FIX — see verifyCode()'s own doc comment on opts.emailPurpose.
    // Must match resendPurposeFor()'s mapping exactly, since that's what
    // decides which purpose an EMAIL-method code was actually sent under.
    const result = await this.verifyCode(userId, method, dto.code, {
      confirmSetup: false,
      emailPurpose: resendPurposeFor(authToken.purpose),
      consume,
    });

    if (result !== 'valid') {
      this.appLogger.error('MFA verify failed', { userId, reason: result });
      await this.audit.log({
        eventType: AuditEventType.AUTH_MFA_FAILURE,
        actorId: userId,
        metadata: { method, purpose: authToken.purpose, reason: result },
        req,
      });
      throw this.mfaFailureException(result);
    }

    this.appLogger.info('MFA verified', { userId, method, peek: !consume });
    await this.audit.log({
      eventType: AuditEventType.AUTH_MFA_SUCCESS,
      actorId: userId,
      metadata: { method, purpose: authToken.purpose, peek: !consume },
      req,
    });

    if (!consume) {
      // Peeked successfully — the caller still needs to re-submit the same
      // code for the real action; nothing further to do here.
      return { verified: true };
    }

    if (authToken.purpose === 'mfa_login') {
      const email = profile?.email ?? authToken.email ?? '';
      // BUG FIX (TASKS_03 TASK 02): this used to return issueTokenPair()'s
      // raw TokenPairResponse (accessToken/refreshToken/expiresIn/
      // AuthUserSummary) directly — but the frontend's challengeMfa() was
      // always typed (and this method's own return type declared) as
      // LoginResponseDto (accessToken/refreshToken/expiresAt/richer user).
      // `expiresIn` (a number of seconds) landing in a field the client
      // reads as `expiresAt` (an ISO string) meant getTokenExpiry() always
      // failed to parse it, shouldRefreshToken() always returned false, and
      // the access token silently expired with nothing on the client ever
      // noticing until the next API call 401'd — same root cause as
      // completeMfaSetup()'s sibling bug just above. Reshaped to match
      // exactly, reusing the same richer loadLoginResponseUser() (not
      // loadUserSummary(), which lacks avatarUrl/activePersona the
      // frontend's session needs).
      const tokenPair = await this.issueTokenPair(userId, email, req, { event: 'mfa_challenge_login' });
      return {
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresAt: minutesFromNow(appConfig.JWT_ACCESS_EXPIRY_MINUTES).toISOString(),
        user: await this.loadLoginResponseUser(userId, email),
      };
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
   * @param opts.emailPurpose - BUG FIX: which email_otp_codes.purpose to
   *   check for the EMAIL method, when it isn't simply derivable from
   *   confirmSetup alone. challengeMfa() is called for TWO different
   *   situations that both pass confirmSetup: false — completing a login
   *   (authToken.purpose === 'mfa_login', code sent under 'login' by
   *   completePasswordVerifiedLogin()) and a sensitive-action re-challenge
   *   for an already-logged-in user (MfaChallengeGuard, any other token
   *   purpose — code sent under 'mfa_change' by resendPurposeFor()'s own
   *   mapping). Only the caller knows which case it is; without this,
   *   every EMAIL-method sensitive-action re-challenge always checked the
   *   wrong purpose ('login') against a code that was actually stored
   *   under 'mfa_change' and could never succeed. Falls back to the old
   *   confirmSetup-derived purpose when omitted (completeMfaSetup()'s own
   *   call site, where confirmSetup: true unambiguously means 'mfa_change').
   */
  private async verifyCode(
    userId: string,
    method: MfaMethod,
    code: string,
    opts: { confirmSetup: boolean; emailPurpose?: EmailOtpPurpose; consume?: boolean },
  ): Promise<MfaCodeCheckResult> {
    if (method === MfaMethod.TOTP) {
      this.appLogger.debug('[AUTH:totpVerify] entry', { userId });
      this.appLogger.debug('[AUTH:totpVerify] fetching secret', { userId });

      const { data: record, error: secretError } = await this.supabase
        .from('mfa_totp_secrets')
        .select('secret, confirmed')
        .eq('user_id', userId)
        .maybeSingle();

      this.appLogger.debug('[AUTH:totpVerify] secret fetch result', { found: !!record, error: secretError?.message });

      if (!record) {
        this.appLogger.warn('[AUTH:totpVerify] no secret on file', { userId });
        return 'invalid';
      }
      if (!opts.confirmSetup && !record.confirmed) {
        this.appLogger.warn('[AUTH:totpVerify] secret not confirmed', { userId });
        return 'invalid';
      }

      this.appLogger.debug('[AUTH:totpVerify] verifying code', { userId, window: 2 });

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

      if (isValid) {
        this.appLogger.info('[AUTH:totpVerify] success', { userId });
      } else {
        this.appLogger.warn('[AUTH:totpVerify] invalid code', { userId });
      }

      return isValid ? 'valid' : 'invalid';
    }

    if (method === MfaMethod.EMAIL) {
      const purpose = opts.emailPurpose ?? (opts.confirmSetup ? 'mfa_change' : 'login');
      return this.checkEmailOtp(userId, code, purpose, opts.consume ?? true);
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

  /**
   * TEMPORARY — see commit "debug: add MFA verification logging". Returns
   * the TOTP code that would currently verify for this user's stored
   * secret, so a dev/staging deploy can confirm whether the secret itself
   * is correct without needing an actual authenticator app. 404s outright
   * in production (not just unauthorized — no confirmation the route even
   * exists) rather than trusting a second guard alone. Never returns the
   * secret itself, only the code it currently produces. Remove this
   * method and its controller route once the root cause is found.
   */
  async debugMfaCode(userId: string): Promise<{ code: string; generatedAt: string }> {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }

    const { data: record } = await this.supabase
      .from('mfa_totp_secrets')
      .select('secret')
      .eq('user_id', userId)
      .maybeSingle();

    if (!record) {
      throw new BadRequestException('No TOTP secret on file for this user');
    }

    return {
      code: speakeasy.totp({ secret: record.secret, encoding: 'base32' }),
      generatedAt: new Date().toISOString(),
    };
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
   * TASKS_06 TASK 08 P1 — server-side session validation, called from
   * JwtStrategy on every request carrying an access token. Before this, the
   * JWT guard only checked the token's signature/expiry/purpose — logout()
   * (and enforceDeviceLimit()'s eviction) already correctly set
   * sessions.revoked_at, but nothing ever consulted that column on the
   * request path, so a still-unexpired access token kept working right up
   * to its own natural JWT expiry even after the session behind it had been
   * revoked. Looks up by sessionId (already embedded in every access
   * token's payload, see issueTokenPair()) rather than re-hashing and
   * matching the access token itself — sessions.id is already a unique,
   * indexed primary key, so hashing the JWT and storing/matching a second
   * hash column would be redundant complexity for the same lookup.
   *
   * Also bumps last_used_at (fire-and-forget — never blocks or fails the
   * request on a write hiccup here) so GET /auth/sessions can show real
   * "last active" times, per P2b.
   */
  async validateSession(sessionId: string | undefined, userId: string): Promise<boolean> {
    if (!sessionId) return false;

    const { data: session } = await this.supabase
      .from('sessions')
      .select('id, revoked_at, expires_at')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!session || session.revoked_at || isExpired(session.expires_at)) {
      return false;
    }

    void this.supabase
      .from('sessions')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', sessionId)
      .then(({ error }) => {
        if (error) {
          this.appLogger.warn('[AUTH:session] last_used_at update failed', { sessionId, error: error.message });
        }
      });

    return true;
  }

  /** TASKS_06 TASK 08 P2a — revokes every active session for this account. */
  async logoutAllDevices(userId: string, req?: Request): Promise<{ message: string; count: number }> {
    this.appLogger.debug('[AUTH:logoutAll] entry', { userId });

    const { data: revoked, error } = await this.supabase
      .from('sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_logout_all' })
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id');

    if (error) {
      this.appLogger.error('[AUTH:logoutAll] failed', {
        userId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to sign out of all devices. Please try again.');
    }

    const count = revoked?.length ?? 0;

    this.appLogger.info('[AUTH:logoutAll] all sessions revoked', { userId, count });
    await this.audit.log({
      eventType: AuditEventType.AUTH_SESSION_INVALIDATED,
      actorId: userId,
      metadata: { reason: 'user_logout_all', evicted_count: count },
      req,
    });

    return { message: 'Signed out from all devices', count };
  }

  /** TASKS_06 TASK 08 P2b — every active session for the caller, newest-active first, flagging which one is the current request's own session. */
  async listSessions(userId: string, currentSessionId: string | undefined) {
    const { data, error } = await this.supabase
      .from('sessions')
      .select('id, user_agent, ip_address, created_at, last_used_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('last_used_at', { ascending: false });

    if (error) {
      this.appLogger.error('[AUTH:sessions] failed', {
        userId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to load sessions');
    }

    return (data ?? []).map((s) => ({
      id: s.id,
      deviceInfo: s.user_agent,
      ipAddress: s.ip_address,
      createdAt: s.created_at,
      lastSeenAt: s.last_used_at,
      isCurrent: s.id === currentSessionId,
    }));
  }

  /** TASKS_06 TASK 08 P2b — revokes one specific session. Scoped to the caller's own userId, same as every other per-row ownership check in this file. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_revoked' })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      this.appLogger.error('[AUTH:sessions] revoke failed', {
        userId,
        sessionId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to revoke this session. Please try again.');
    }

    if (!data) {
      throw new NotFoundException('Session not found');
    }
  }

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
    this.appLogger.debug('[AUTH:logout] entry', { userId, allDevices: !!dto.allDevices });

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

    this.appLogger.info('[AUTH:logout] success', { userId });
    await this.audit.log({
      eventType: AuditEventType.AUTH_LOGOUT,
      actorId: userId,
      metadata: { all_devices: !!dto.allDevices },
      req,
    });
  }

  // ── Password reset ───────────────────────────────────────────────────────

  /**
   * Always resolves the same way regardless of whether the email matches an
   * account — the response never reveals account existence, matching how
   * every other auth flow in this file avoids leaking that (e.g. login's
   * shared "incorrect email or password" message).
   */
  async forgotPassword(dto: ForgotPasswordDto, req?: Request): Promise<{ message: string }> {
    this.appLogger.debug('[AUTH:forgotPwd] entry', { email: AppLogger.maskEmail(dto.email) });
    const message = 'If that email exists a reset link was sent';

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id, mfa_enabled, mfa_method')
      .eq('email', dto.email)
      .maybeSingle();

    this.appLogger.debug('[AUTH:forgotPwd] user lookup', { found: !!profile });

    if (!profile) {
      return { message };
    }

    // Email-MFA accounts need a code alongside the reset link itself — see
    // resetPassword()'s own comment for why this is required there.
    if (profile.mfa_enabled && profile.mfa_method === MfaMethod.EMAIL) {
      await this.sendEmailOtp(profile.id, dto.email, 'password_reset');
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(
      Date.now() + appConfig.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES * 60_000,
    ).toISOString();

    this.appLogger.debug('[AUTH:forgotPwd] storing token', { userId: profile.id });
    const { error } = await this.supabase.from('password_reset_tokens').insert({
      user_id: profile.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    if (error) {
      this.appLogger.error('[AUTH:forgotPwd] failed', {
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      return { message };
    }

    // FRONTEND_URL, not a hardcoded domain — same reasoning as
    // AuthController's googleCallback() redirect: this must point at
    // localhost in dev and alumtribe.com in production, driven by the
    // same env var Render is already configured with.
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${rawToken}`;

    // Delivery failures never surface as an API error here (that would leak
    // "this email exists but sending failed" vs. "doesn't exist") —
    // EmailService itself already swallows send failures after logging them.
    await this.emailService.sendPasswordResetLink(dto.email, resetUrl);

    await this.audit.log({
      eventType: AuditEventType.AUTH_PASSWORD_RESET_REQUESTED,
      actorId: profile.id,
      req,
    });

    this.appLogger.info('[AUTH:forgotPwd] token created and email sent', { userId: profile.id });
    return { message };
  }

  async resetPassword(dto: ResetPasswordDto, req?: Request): Promise<{ message: string }> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    this.appLogger.debug('[AUTH:resetPwd] entry', { tokenPrefix: dto.token?.slice(0, 8) });

    const { data: record } = await this.supabase
      .from('password_reset_tokens')
      .select('id, user_id, expires_at, used')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    this.appLogger.debug('[AUTH:resetPwd] token lookup result', {
      found: !!record,
      used: record?.used,
      expired: record ? isExpired(record.expires_at) : null,
    });

    if (!record) {
      this.appLogger.warn('[AUTH:resetPwd] invalid token', { reason: 'not_found' });
      throw new BadRequestException('Invalid or expired link');
    }
    if (record.used) {
      this.appLogger.warn('[AUTH:resetPwd] invalid token', { reason: 'used' });
      throw new BadRequestException('Link already used');
    }
    if (isExpired(record.expires_at)) {
      this.appLogger.warn('[AUTH:resetPwd] invalid token', { reason: 'expired' });
      throw new BadRequestException('Link has expired');
    }

    // A valid reset link proves the user clicked a link sent to their
    // inbox — MFA (a SECOND factor) still gates the actual password
    // change for an MFA-enabled account, same as any other sensitive
    // action (SPEC.md §11.2). email/totp only — SMS setup isn't reachable
    // from initiateMfaSetup() at login/reset time today, an existing gap
    // this task doesn't touch.
    const { data: mfaProfile } = await this.supabase
      .from('profiles')
      .select('mfa_enabled, mfa_method')
      .eq('id', record.user_id)
      .maybeSingle();

    if (mfaProfile?.mfa_enabled && (mfaProfile.mfa_method === MfaMethod.EMAIL || mfaProfile.mfa_method === MfaMethod.TOTP)) {
      if (!dto.mfaCode) {
        throw new BadRequestException({
          message: `A verification code is required to reset your password`,
          error: 'MFA_CODE_REQUIRED',
          mfaMethod: mfaProfile.mfa_method,
        });
      }

      const result =
        mfaProfile.mfa_method === MfaMethod.EMAIL
          ? await this.checkEmailOtp(record.user_id, dto.mfaCode, 'password_reset')
          : await this.verifyCode(record.user_id, MfaMethod.TOTP, dto.mfaCode, { confirmSetup: false });

      if (result !== 'valid') {
        throw this.mfaFailureException(result);
      }
    }

    const { error: updateError } = await this.supabase.auth.admin.updateUserById(record.user_id, {
      password: dto.password,
    });
    if (updateError) {
      this.appLogger.error('[AUTH:resetPwd] failed', {
        error: updateError.message,
        code: updateError.code,
        hint: undefined,
        details: undefined,
        userId: record.user_id,
      });
      throw new BadRequestException('Could not reset password. Please try again.');
    }

    await this.supabase
      .from('password_reset_tokens')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', record.id);

    // Same "revoke every active session" shape as logout({allDevices: true})
    // — a password reset should sign the account out everywhere, including
    // wherever the old password is still an active session.
    await this.supabase
      .from('sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'password_reset' })
      .eq('user_id', record.user_id)
      .is('revoked_at', null);

    this.appLogger.info('[AUTH:resetPwd] success', { userId: record.user_id });
    await this.audit.log({
      eventType: AuditEventType.AUTH_PASSWORD_CHANGED,
      actorId: record.user_id,
      req,
    });

    return { message: 'Password reset successfully' };
  }

  /**
   * TASKS_06 TASK 05 — changes the password for an already-logged-in
   * user. Unlike resetPassword() (unauthenticated, reset-token-driven,
   * revokes every session), this is reached via a session the caller
   * already holds: MFA re-challenge is enforced by MfaChallengeGuard at
   * the controller (X-MFA-Code header) before this ever runs, so there's
   * no separate mfaCode field or MFA branch here. Per the task's own
   * explicit requirement, this does NOT revoke sessions or log the caller
   * out — only resetPassword()'s "reset via emailed link" flow does that,
   * since that flow can't distinguish the legitimate owner acting from
   * home from an attacker who intercepted the link.
   */
  async changePassword(userId: string, newPassword: string, req?: Request): Promise<{ message: string }> {
    const { error } = await this.supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      this.appLogger.error('[AUTH:changePwd] failed', {
        userId,
        error: error.message,
        code: error.code,
      });
      throw new BadRequestException('Could not change password. Please try again.');
    }

    this.appLogger.info('[AUTH:changePwd] success', { userId });
    await this.audit.log({
      eventType: AuditEventType.AUTH_PASSWORD_CHANGED,
      actorId: userId,
      metadata: { via: 'authenticated_change' },
      req,
    });

    return { message: 'Password changed successfully' };
  }

  // ── MFA reset / recovery ─────────────────────────────────────────────────

  /**
   * Support/dev tool — wipes MFA enrolment for an account by email,
   * gated by a shared secret header (X-Dev-Key, checked in the
   * controller) rather than NODE_ENV, since it's meant to be usable
   * against a real (including production) account a support request
   * needs unblocked, not just a dev/staging one. Audited like every
   * other auth-state change in this file.
   */
  async resetMfaDev(dto: MfaResetDevDto, req?: Request): Promise<{ message: string }> {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', dto.email)
      .maybeSingle();

    if (!profile) {
      throw new BadRequestException('No account found for that email');
    }

    await this.clearMfaEnrollment(profile.id);

    await this.audit.log({
      eventType: AuditEventType.AUTH_MFA_RESET,
      actorId: profile.id,
      metadata: { via: 'dev_key' },
      req,
    });

    return { message: 'MFA reset. Please set up again.' };
  }

  /**
   * Always resolves the same way regardless of whether the email matches
   * an account — same privacy reasoning as forgotPassword().
   */
  async requestMfaRecovery(dto: MfaRecoveryRequestDto, req?: Request): Promise<{ message: string }> {
    this.appLogger.debug('[AUTH:mfaRecovery] entry', { email: AppLogger.maskEmail(dto.email) });
    const message = 'If that email exists a recovery link was sent';

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', dto.email)
      .maybeSingle();

    if (!profile) {
      return { message };
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(
      Date.now() + appConfig.MFA_RECOVERY_TOKEN_EXPIRY_MINUTES * 60_000,
    ).toISOString();

    const { error } = await this.supabase.from('mfa_recovery_tokens').insert({
      user_id: profile.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    if (error) {
      this.appLogger.error('[AUTH:mfaRecovery] failed', {
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
        userId: profile.id,
      });
      return { message };
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const recoveryUrl = `${frontendUrl}/auth/mfa-recovery?token=${rawToken}`;

    await this.emailService.sendMfaRecoveryLink(dto.email, recoveryUrl);

    await this.audit.log({
      eventType: AuditEventType.AUTH_MFA_RECOVERY_REQUESTED,
      actorId: profile.id,
      req,
    });

    this.appLogger.info('[AUTH:mfaRecovery] email sent', { userId: profile.id });
    return { message };
  }

  async verifyMfaRecovery(dto: MfaRecoveryVerifyDto, req?: Request): Promise<MfaRequiredResponse> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');

    const { data: record } = await this.supabase
      .from('mfa_recovery_tokens')
      .select('id, user_id, expires_at, used')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!record) {
      throw new BadRequestException('Invalid or expired link');
    }
    if (record.used) {
      throw new BadRequestException('Link already used');
    }
    if (isExpired(record.expires_at)) {
      throw new BadRequestException('Link has expired');
    }

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('email')
      .eq('id', record.user_id)
      .single();

    await this.clearMfaEnrollment(record.user_id);

    await this.supabase
      .from('mfa_recovery_tokens')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', record.id);

    await this.audit.log({
      eventType: AuditEventType.AUTH_MFA_RESET,
      actorId: record.user_id,
      metadata: { via: 'recovery_token' },
      req,
    });

    const mfaPendingToken = await this.signToken(
      { sub: record.user_id, email: profile?.email, purpose: 'mfa_setup' },
      this.minutes(appConfig.MFA_PENDING_TOKEN_EXPIRY_MINUTES),
    );

    return { mfaRequired: true, mfaPendingToken, mfaMethod: null };
  }

  /**
   * Shared by resetMfaDev() and verifyMfaRecovery() — wipes every MFA
   * factor for an account (not just TOTP; a full reset should clear SMS
   * challenges too) and turns MFA off on the profile so the next login
   * routes back into first-time setup.
   */
  private async clearMfaEnrollment(userId: string): Promise<void> {
    await this.supabase.from('mfa_totp_secrets').delete().eq('user_id', userId);
    await this.supabase.from('mfa_sms_challenges').delete().eq('user_id', userId);
    await this.supabase.from('email_otp_codes').delete().eq('user_id', userId);
    await this.supabase
      .from('profiles')
      .update({ mfa_enabled: false, mfa_method: null })
      .eq('id', userId);
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
    this.appLogger.debug('[AUTH:session] creating', { userId });
    await this.enforceDeviceLimit(userId, req);

    const sessionId = randomUUID();
    const userAgent = (req?.headers['user-agent'] as string) ?? null;
    const ipAddress = this.extractIp(req) ?? null;

    // TASKS_06 TASK 08 P3 — device fingerprinting for forensics/debugging
    // only. Never blocks or restricts the login itself — just a fact for
    // Render logs. "New device" is a simple heuristic (has this exact
    // User-Agent string ever been recorded for this user before?), not a
    // real device-identity system — good enough for a forensic trail, not
    // meant to be spoof-proof.
    let isNewDevice = true;
    if (userAgent) {
      const { data: priorDeviceSessions } = await this.supabase
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
        .eq('user_agent', userAgent)
        .limit(1);
      isNewDevice = !priorDeviceSessions || priorDeviceSessions.length === 0;
    }

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
      user_agent: userAgent,
      ip_address: ipAddress,
      expires_at: daysFromNow(appConfig.JWT_EXPIRY_DAYS).toISOString(),
    });

    this.appLogger.debug('[AUTH:session] db result', { success: !error, error: error?.message });

    if (error) {
      this.appLogger.error('[AUTH:session] failed', {
        userId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to complete sign-in. Please try again.');
    }

    this.appLogger.info('[AUTH:session] created', { userId, sessionId });
    this.appLogger.info('[AUTH:login:device]', {
      userId,
      userAgent: userAgent?.slice(0, 100) ?? null,
      ip: ipAddress,
      isNewDevice,
    });
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
