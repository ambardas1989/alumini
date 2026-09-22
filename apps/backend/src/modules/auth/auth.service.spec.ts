/**
 * Unit tests for AuthService.
 *
 * Covers:
 * - signup(): account creation, MFA-pending response, Supabase failure
 * - login(): invalid credentials (audited failure), MFA-pending response
 *   for both an enrolled and an unenrolled account
 * - initiateMfaSetup(): TOTP QR generation, SMS blocked for school admins
 * - completeMfaSetup(): wrong code rejected, correct code enables MFA and
 *   issues a full session
 * - challengeMfa(): login completion vs sensitive-action re-challenge
 * - refreshTokens(): revoked session rejected, valid session rotates tokens
 * - logout(): revokes the session and audits it
 * - concurrent device limit: oldest session evicted once at the cap
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as speakeasy from 'speakeasy';
import { createHash } from 'crypto';

import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType, MfaMethod } from '@alumini/types';
import { daysFromNow } from '@alumini/utils';

// ── Supabase mock ──────────────────────────────────────────────────────────
//
// Every AuthService method that touches the DB does so via `.from(table)...`.
// Rather than hand-sequence every chained call (fragile once several tables
// are hit in one flow), each table gets one thenable "chain" stub whose
// terminal methods (single/maybeSingle/await-directly) all resolve to the
// same pre-set { data, error }. Tests only assert on `error` for writes and
// on `data` shape for the reads that matter to that specific test.

const mockCreateUser = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockUpdateUserById = jest.fn().mockResolvedValue({ data: {}, error: null });
let fromTables: Record<string, any> = {};

function chain(result: { data: any; error: any; count?: number } = { data: null, error: null }) {
  const builder: any = {};
  ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'is', 'gt', 'gte', 'in', 'order', 'limit'].forEach(
    (method) => {
      builder[method] = jest.fn(() => builder);
    },
  );
  builder.single = jest.fn().mockResolvedValue(result);
  builder.maybeSingle = jest.fn().mockResolvedValue(result);
  builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

/** Sets up which chain each table returns for the current test. Unlisted tables get an empty default. */
function mockTables(overrides: Record<string, ReturnType<typeof chain>>) {
  fromTables = overrides;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      admin: {
        createUser: (...args: any[]) => mockCreateUser(...args),
        updateUserById: (...args: any[]) => mockUpdateUserById(...args),
      },
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
    },
    from: (table: string) => fromTables[table] ?? chain(),
  })),
}));

// ── Test suite ───────────────────────────────────────────────────────────────

/** TASKS_05 TASK 11 — every service now injects AppLogger; a no-op mock keeps every existing spec's providers array valid. */
const mockAppLogger = { setContext: jest.fn().mockReturnThis(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('AuthService', () => {
  let service: AuthService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockEventEmit = jest.fn();

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        { provide: JwtService, useValue: new JwtService({}) },
        { provide: EventEmitter2, useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() } },
        { provide: AppLogger, useValue: mockAppLogger },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── signup() ──────────────────────────────────────────────────────────────

  describe('signup()', () => {
    const dto = { email: 'new@example.com', password: 'Passw0rd!', fullName: 'New User' };

    it('creates the account and returns an mfa_setup pending token (MFA is mandatory)', async () => {
      mockCreateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

      const result: any = await service.signup(dto as any);

      expect(result.mfaRequired).toBe(true);
      expect(result.mfaMethod).toBeNull();
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: dto.email, password: dto.password }),
      );

      const jwt = new JwtService({});
      const payload: any = await jwt.verifyAsync(result.mfaPendingToken, {
        secret: process.env.JWT_SECRET,
      });
      expect(payload.purpose).toBe('mfa_setup');
      expect(payload.sub).toBe('user-1');
    });

    it('throws BadRequestException when Supabase account creation fails for a non-duplicate reason', async () => {
      mockCreateUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Unable to validate email address: invalid format' },
      });

      await expect(service.signup(dto as any)).rejects.toThrow(BadRequestException);
    });

    // BUG FIX (TASKS_05 TASK 09) — this used to throw a plain
    // BadRequestException for this exact case, which is what made a
    // duplicate signup look like an unexplained "something went wrong" to
    // the frontend. Now a structured 409 the UI can show a specific
    // "sign in instead?" message for.
    it('throws ConflictException with AUTH_ACCOUNT_EXISTS when the email is already registered', async () => {
      mockCreateUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'User already registered' },
      });

      await expect(service.signup(dto as any)).rejects.toThrow(ConflictException);
      await expect(service.signup(dto as any)).rejects.toMatchObject({
        response: { error: 'AUTH_ACCOUNT_EXISTS' },
      });
    });
  });

  // ── login() ───────────────────────────────────────────────────────────────

  describe('login()', () => {
    const dto = { email: 'user@example.com', password: 'wrongOrRight' };

    it('audits a failure and throws UnauthorizedException on bad credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.login(dto as any)).rejects.toThrow(UnauthorizedException);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_LOGIN_FAILURE }),
      );
    });

    it('returns an mfa_login pending token when MFA is already enabled', async () => {
      mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null });
      mockTables({
        profiles: chain({ data: { mfa_enabled: true, mfa_method: MfaMethod.TOTP }, error: null }),
      });

      const result: any = await service.login(dto as any);

      expect(result.mfaRequired).toBe(true);
      expect(result.mfaMethod).toBe(MfaMethod.TOTP);

      const jwt = new JwtService({});
      const payload: any = await jwt.verifyAsync(result.mfaPendingToken, {
        secret: process.env.JWT_SECRET,
      });
      expect(payload.purpose).toBe('mfa_login');
    });

    it('returns an mfa_setup pending token when the account never finished enrolling', async () => {
      mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'user-3' } }, error: null });
      mockTables({
        profiles: chain({ data: { mfa_enabled: false, mfa_method: null }, error: null }),
      });

      const result: any = await service.login(dto as any);

      expect(result.mfaRequired).toBe(true);
      expect(result.mfaMethod).toBeNull();
    });

    it("sends an email OTP when the account's mfa_method is 'email'", async () => {
      mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'user-4' } }, error: null });
      mockTables({
        profiles: chain({ data: { mfa_enabled: true, mfa_method: MfaMethod.EMAIL }, error: null }),
      });
      const sendEmailOtpSpy = jest.spyOn(service, 'sendEmailOtp').mockResolvedValue({ message: 'Code sent to your email' });

      await service.login(dto as any);

      expect(sendEmailOtpSpy).toHaveBeenCalledWith('user-4', dto.email, 'login');
    });

    it("does not send an email OTP when the account's mfa_method is 'totp'", async () => {
      mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'user-5' } }, error: null });
      mockTables({
        profiles: chain({ data: { mfa_enabled: true, mfa_method: MfaMethod.TOTP }, error: null }),
      });
      const sendEmailOtpSpy = jest.spyOn(service, 'sendEmailOtp').mockResolvedValue({ message: 'Code sent to your email' });

      await service.login(dto as any);

      expect(sendEmailOtpSpy).not.toHaveBeenCalled();
    });
  });

  // ── sendEmailOtp() / verifyEmailOtp() ────────────────────────────────────

  describe('sendEmailOtp()', () => {
    it('generates and stores a hashed code', async () => {
      const insertMock = jest.fn((..._args: any[]) => insertBuilder);
      const insertBuilder: any = { then: (resolve: any) => Promise.resolve({ error: null }).then(resolve) };
      mockTables({
        email_otp_codes: { ...chain({ data: null, error: null, count: 0 }), insert: insertMock },
      });

      const result = await service.sendEmailOtp('user-1', 'user@example.com', 'login');

      expect(result.message).toBe('Code sent to your email');
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          purpose: 'login',
          code_hash: expect.any(String),
        }),
      );
      // Never the raw code — only a hash.
      const insertedPatch = insertMock.mock.calls[0][0];
      expect(insertedPatch.code_hash).toHaveLength(64); // sha256 hex
    });

    it('rate-limits after 3 codes in the last 10 minutes', async () => {
      mockTables({
        email_otp_codes: chain({ data: null, error: null, count: 3 }),
      });

      await expect(service.sendEmailOtp('user-1', 'user@example.com', 'login')).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyEmailOtp()', () => {
    const hash = (code: string) => createHash('sha256').update(code).digest('hex');

    it('succeeds with the correct code', async () => {
      mockTables({
        email_otp_codes: chain({
          data: { id: 'otp-1', code_hash: hash('123456'), attempts: 0, expires_at: daysFromNow(1).toISOString() },
          error: null,
        }),
      });

      await expect(service.verifyEmailOtp('user-1', '123456', 'login')).resolves.toBe(true);
    });

    it('fails with the wrong code', async () => {
      mockTables({
        email_otp_codes: chain({
          data: { id: 'otp-1', code_hash: hash('123456'), attempts: 0, expires_at: daysFromNow(1).toISOString() },
          error: null,
        }),
      });

      await expect(service.verifyEmailOtp('user-1', '000000', 'login')).rejects.toThrow(UnauthorizedException);
    });

    it('fails with an expired code', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      mockTables({
        email_otp_codes: chain({
          data: { id: 'otp-1', code_hash: hash('123456'), attempts: 0, expires_at: past },
          error: null,
        }),
      });

      await expect(service.verifyEmailOtp('user-1', '123456', 'login')).rejects.toThrow(UnauthorizedException);
    });

    it('fails when no unconsumed code exists (already used)', async () => {
      // checkEmailOtp() only ever selects `used = false` rows — an
      // already-used code simply won't be found, same shape as "no code
      // was ever sent".
      mockTables({
        email_otp_codes: chain({ data: null, error: null }),
      });

      await expect(service.verifyEmailOtp('user-1', '123456', 'login')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── initiateMfaSetup() ───────────────────────────────────────────────────

  describe('initiateMfaSetup()', () => {
    it('generates a TOTP secret and a scannable QR code', async () => {
      mockTables({ mfa_totp_secrets: chain({ data: null, error: null }) });

      const result: any = await service.initiateMfaSetup('user-1', 'user@example.com', {
        method: MfaMethod.TOTP,
      } as any);

      expect(result.method).toBe(MfaMethod.TOTP);
      expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(typeof result.secret).toBe('string');
    });

    it('rejects SMS setup for a school admin — TOTP only', async () => {
      mockTables({
        personas: chain({ data: { id: 'persona-1' }, error: null }), // found → is a school admin
      });

      await expect(
        service.initiateMfaSetup('admin-1', 'admin@example.com', {
          method: MfaMethod.SMS,
          phone: '+919876543210',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── completeMfaSetup() ───────────────────────────────────────────────────

  describe('completeMfaSetup()', () => {
    const secret = speakeasy.generateSecret({ length: 20 });
    const validCode = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });
    const invalidCode = ((parseInt(validCode, 10) + 500_000) % 1_000_000).toString().padStart(6, '0');

    it('rejects an incorrect code and audits the failure', async () => {
      mockTables({
        mfa_totp_secrets: chain({ data: { secret: secret.base32, confirmed: false }, error: null }),
      });

      await expect(
        service.completeMfaSetup('user-1', 'user@example.com', {
          method: MfaMethod.TOTP,
          code: invalidCode,
        } as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_MFA_FAILURE }),
      );
    });

    it('enables MFA and issues a full session on a correct code', async () => {
      mockTables({
        mfa_totp_secrets: chain({ data: { secret: secret.base32, confirmed: false }, error: null }),
        profiles: chain({
          data: { id: 'user-1', email: 'user@example.com', full_name: 'User', mfa_enabled: true },
          error: null,
        }),
        sessions: chain({ data: [], error: null }),
      });

      const result = await service.completeMfaSetup('user-1', 'user@example.com', {
        method: MfaMethod.TOTP,
        code: validCode,
      } as any);

      expect(result.accessToken).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(result.user).toEqual(
        expect.objectContaining({ id: 'user-1', email: 'user@example.com' }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_MFA_SETUP }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_LOGIN_SUCCESS }),
      );
    });
  });

  // ── challengeMfa() ───────────────────────────────────────────────────────

  describe('challengeMfa()', () => {
    const secret = speakeasy.generateSecret({ length: 20 });
    const validCode = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });

    beforeEach(() => {
      mockTables({
        mfa_totp_secrets: chain({ data: { secret: secret.base32, confirmed: true }, error: null }),
        profiles: chain({
          data: {
            id: 'user-1',
            email: 'user@example.com',
            full_name: 'User',
            mfa_enabled: true,
            mfa_method: MfaMethod.TOTP,
          },
          error: null,
        }),
        sessions: chain({ data: [], error: null }),
      });
    });

    it('completes login and issues a full session for an mfa_login token', async () => {
      const result: any = await service.challengeMfa(
        { sub: 'user-1', email: 'user@example.com', purpose: 'mfa_login' },
        { code: validCode } as any,
      );

      expect(result.accessToken).toBeDefined();
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_LOGIN_SUCCESS }),
      );
    });

    it('accepts a code up to 60s clock-drifted (window: 2), still rejects one further out', async () => {
      const driftedCode = speakeasy.totp({
        secret: secret.base32,
        encoding: 'base32',
        time: Date.now() / 1000 - 60, // 2 time-steps ago
      });
      const tooOldCode = speakeasy.totp({
        secret: secret.base32,
        encoding: 'base32',
        time: Date.now() / 1000 - 120, // 4 time-steps ago — outside window: 2
      });

      const result: any = await service.challengeMfa(
        { sub: 'user-1', email: 'user@example.com', purpose: 'mfa_login' },
        { code: driftedCode } as any,
      );
      expect(result.accessToken).toBeDefined();

      await expect(
        service.challengeMfa(
          { sub: 'user-1', email: 'user@example.com', purpose: 'mfa_login' },
          { code: tooOldCode } as any,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('re-authorises a sensitive action for an access token without issuing new tokens', async () => {
      const result: any = await service.challengeMfa(
        { sub: 'user-1', email: 'user@example.com', purpose: 'access', sessionId: 'sess-1' },
        { code: validCode } as any,
      );

      expect(result).toEqual({ verified: true });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_MFA_CHALLENGE }),
      );
      expect(mockAuditLog).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_LOGIN_SUCCESS }),
      );
    });
  });

  // ── refreshTokens() ──────────────────────────────────────────────────────

  describe('refreshTokens()', () => {
    async function signRefreshToken(sessionId: string) {
      const jwt = new JwtService({});
      return jwt.signAsync(
        { sub: 'user-1', email: 'user@example.com', purpose: 'refresh', sessionId },
        { secret: process.env.JWT_SECRET, expiresIn: '7d' },
      );
    }

    it('rejects a revoked session', async () => {
      const refreshToken = await signRefreshToken('sess-revoked');
      mockTables({
        sessions: chain({
          data: {
            id: 'sess-revoked',
            user_id: 'user-1',
            revoked_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
          error: null,
        }),
      });

      await expect(service.refreshTokens({ refreshToken } as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates the token pair for a valid session and audits the refresh', async () => {
      const refreshToken = await signRefreshToken('sess-active');
      mockTables({
        sessions: chain({
          data: {
            id: 'sess-active',
            user_id: 'user-1',
            revoked_at: null,
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
          error: null,
        }),
        profiles: chain({
          data: { id: 'user-1', email: 'user@example.com', full_name: 'User', mfa_enabled: true },
          error: null,
        }),
      });

      const result = await service.refreshTokens({ refreshToken } as any);

      // Not asserting refreshToken !== the original: signing the same payload
      // within the same second produces an identical HS256 JWT (no nonce), so
      // that equality check is flaky by construction, not a sign of a bug.
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_TOKEN_REFRESHED }),
      );
    });
  });

  // ── logout() ─────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('revokes the current session and audits the logout', async () => {
      mockTables({ sessions: chain({ data: null, error: null }) });

      await service.logout(
        { sub: 'user-1', email: 'user@example.com', purpose: 'access', sessionId: 'sess-1' },
        {} as any,
      );

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.AUTH_LOGOUT,
          actorId: 'user-1',
          metadata: { all_devices: false },
        }),
      );
    });
  });

  // ── forgotPassword() ─────────────────────────────────────────────────────

  describe('forgotPassword()', () => {
    it('returns the generic message and audits nothing when the email has no account', async () => {
      mockTables({ profiles: chain({ data: null, error: null }) });

      const result = await service.forgotPassword({ email: 'nobody@example.com' } as any);

      expect(result).toEqual({ message: 'If that email exists a reset link was sent' });
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('stores a hashed token and audits the request when the email matches an account', async () => {
      mockTables({
        profiles: chain({ data: { id: 'user-1' }, error: null }),
        password_reset_tokens: chain({ data: null, error: null }),
      });

      const result = await service.forgotPassword({ email: 'user@example.com' } as any);

      expect(result).toEqual({ message: 'If that email exists a reset link was sent' });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.AUTH_PASSWORD_RESET_REQUESTED,
          actorId: 'user-1',
        }),
      );
    });
  });

  // ── resetPassword() ──────────────────────────────────────────────────────

  describe('resetPassword()', () => {
    it('rejects an unknown token', async () => {
      mockTables({ password_reset_tokens: chain({ data: null, error: null }) });

      await expect(
        service.resetPassword({ token: 'bogus', password: 'NewPassw0rd!' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-used token', async () => {
      mockTables({
        password_reset_tokens: chain({
          data: { id: 'trt-1', user_id: 'user-1', expires_at: daysFromNow(1).toISOString(), used: true },
          error: null,
        }),
      });

      await expect(
        service.resetPassword({ token: 'used-token', password: 'NewPassw0rd!' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      mockTables({
        password_reset_tokens: chain({
          data: { id: 'trt-1', user_id: 'user-1', expires_at: daysFromNow(-1).toISOString(), used: false },
          error: null,
        }),
      });

      await expect(
        service.resetPassword({ token: 'expired-token', password: 'NewPassw0rd!' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the password, revokes sessions, and audits the change on a valid token', async () => {
      mockTables({
        password_reset_tokens: chain({
          data: { id: 'trt-1', user_id: 'user-1', expires_at: daysFromNow(1).toISOString(), used: false },
          error: null,
        }),
        sessions: chain({ data: null, error: null }),
      });

      const result = await service.resetPassword({ token: 'valid-token', password: 'NewPassw0rd!' } as any);

      expect(result).toEqual({ message: 'Password reset successfully' });
      expect(mockUpdateUserById).toHaveBeenCalledWith('user-1', { password: 'NewPassw0rd!' });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.AUTH_PASSWORD_CHANGED,
          actorId: 'user-1',
        }),
      );
    });
  });

  // ── resetMfaDev() ────────────────────────────────────────────────────────

  describe('resetMfaDev()', () => {
    it('rejects when the email has no account', async () => {
      mockTables({ profiles: chain({ data: null, error: null }) });

      await expect(service.resetMfaDev({ email: 'nobody@example.com' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('clears MFA enrolment and audits it when the email matches an account', async () => {
      mockTables({
        profiles: chain({ data: { id: 'user-1' }, error: null }),
        mfa_totp_secrets: chain({ data: null, error: null }),
        mfa_sms_challenges: chain({ data: null, error: null }),
      });

      const result = await service.resetMfaDev({ email: 'user@example.com' } as any);

      expect(result).toEqual({ message: 'MFA reset. Please set up again.' });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.AUTH_MFA_RESET,
          actorId: 'user-1',
          metadata: { via: 'dev_key' },
        }),
      );
    });
  });

  // ── requestMfaRecovery() ─────────────────────────────────────────────────

  describe('requestMfaRecovery()', () => {
    it('returns the generic message and audits nothing when the email has no account', async () => {
      mockTables({ profiles: chain({ data: null, error: null }) });

      const result = await service.requestMfaRecovery({ email: 'nobody@example.com' } as any);

      expect(result).toEqual({ message: 'If that email exists a recovery link was sent' });
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('stores a hashed token and audits the request when the email matches an account', async () => {
      mockTables({
        profiles: chain({ data: { id: 'user-1' }, error: null }),
        mfa_recovery_tokens: chain({ data: null, error: null }),
      });

      const result = await service.requestMfaRecovery({ email: 'user@example.com' } as any);

      expect(result).toEqual({ message: 'If that email exists a recovery link was sent' });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.AUTH_MFA_RECOVERY_REQUESTED,
          actorId: 'user-1',
        }),
      );
    });
  });

  // ── verifyMfaRecovery() ──────────────────────────────────────────────────

  describe('verifyMfaRecovery()', () => {
    it('rejects an unknown token', async () => {
      mockTables({ mfa_recovery_tokens: chain({ data: null, error: null }) });

      await expect(service.verifyMfaRecovery({ token: 'bogus' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an already-used token', async () => {
      mockTables({
        mfa_recovery_tokens: chain({
          data: { id: 'mrt-1', user_id: 'user-1', expires_at: daysFromNow(1).toISOString(), used: true },
          error: null,
        }),
      });

      await expect(service.verifyMfaRecovery({ token: 'used-token' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired token', async () => {
      mockTables({
        mfa_recovery_tokens: chain({
          data: { id: 'mrt-1', user_id: 'user-1', expires_at: daysFromNow(-1).toISOString(), used: false },
          error: null,
        }),
      });

      await expect(service.verifyMfaRecovery({ token: 'expired-token' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('clears MFA and returns a fresh mfa_setup pending token on a valid token', async () => {
      mockTables({
        mfa_recovery_tokens: chain({
          data: { id: 'mrt-1', user_id: 'user-1', expires_at: daysFromNow(1).toISOString(), used: false },
          error: null,
        }),
        profiles: chain({ data: { email: 'user@example.com' }, error: null }),
        mfa_totp_secrets: chain({ data: null, error: null }),
        mfa_sms_challenges: chain({ data: null, error: null }),
      });

      const result = await service.verifyMfaRecovery({ token: 'valid-token' } as any);

      expect(result.mfaRequired).toBe(true);
      expect(result.mfaMethod).toBeNull();
      expect(result.mfaPendingToken).toBeDefined();
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.AUTH_MFA_RESET,
          actorId: 'user-1',
          metadata: { via: 'recovery_token' },
        }),
      );
    });
  });

  // ── Concurrent device limit ──────────────────────────────────────────────

  describe('device limit', () => {
    it('evicts the oldest session once the account is at the concurrent-device cap', async () => {
      const secret = speakeasy.generateSecret({ length: 20 });
      const validCode = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });

      // appConfig.SESSION_MAX_DEVICES is 5 — five already-active sessions means
      // the next login must evict the oldest to stay at the cap.
      const activeSessions = Array.from({ length: 5 }, (_, i) => ({
        id: `sess-${i}`,
        created_at: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
      }));

      mockTables({
        mfa_totp_secrets: chain({ data: { secret: secret.base32, confirmed: true }, error: null }),
        profiles: chain({
          data: {
            id: 'user-1',
            email: 'user@example.com',
            full_name: 'User',
            mfa_enabled: true,
            mfa_method: MfaMethod.TOTP,
          },
          error: null,
        }),
        sessions: chain({ data: activeSessions, error: null }),
      });

      await service.challengeMfa(
        { sub: 'user-1', email: 'user@example.com', purpose: 'mfa_login' },
        { code: validCode } as any,
      );

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AUTH_SESSION_INVALIDATED }),
      );
    });
  });
});
