/**
 * AuthController — HTTP surface for apps/backend/src/modules/auth.
 * Route shapes follow SPEC.md §17.2.
 *
 * Guard usage:
 * - AuthTokenGuard: accepts any signed app token (access, refresh purpose
 *   tokens excluded — only used at /auth/refresh directly). Used on the
 *   /auth/mfa/* routes, which are deliberately reachable by more than one
 *   token purpose — see AuthTokenPayload in auth.types.ts.
 * - JwtAuthGuard: requires a full `access` token. Used where the caller must
 *   already be a fully logged-in user (logout).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

import { AuthService, resendPurposeFor } from './auth.service';
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
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthTokenGuard } from './guards/auth-token.guard';
import { MfaChallengeGuard } from './guards/mfa-challenge.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthTokenPayload } from './auth.types';
import { GoogleProfile } from './strategies/google.strategy';
import { LinkedinConnectDto } from './dto/linkedin-connect.dto';

/**
 * IMPORTANT: Add FRONTEND_URL=https://alumtribe.com to Render environment
 * variables before testing Google OAuth on production. Without this, OAuth
 * redirects to localhost.
 */
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Constant-time comparison for the X-Dev-Key header against
 * DEV_RESET_KEY — a plain `===` would leak how many leading characters
 * matched via response timing, letting an attacker brute-force the key
 * character by character.
 */
function matchesDevResetKey(provided: string | undefined): boolean {
  const expected = process.env.DEV_RESET_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Signup / Login ────────────────────────────────────────────────────────

  @Post('signup')
  @ApiOperation({ summary: 'Create an account with email + password. MFA enrolment follows.' })
  async signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.authService.signup(dto, req);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email + password. Returns an MFA challenge, not a session.' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset link — always responds the same whether or not the email exists' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, req);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a password reset using the token from the emailed link' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, req);
  }

  // ── Google OAuth ─────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Start Google OAuth — redirects to the Google consent screen' })
  googleAuth(): void {
    // Intercepted by GoogleStrategy before this body ever runs.
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback — completes account link/creation' })
  async googleCallback(@Req() req: Request & { user: GoogleProfile }, @Res() res: Response): Promise<void> {
    const result = await this.authService.loginWithGoogle(req.user, req);

    // SECURITY: this used to `return result` directly — NestJS serialises
    // that to a raw JSON body, so the browser's final GET (a plain
    // top-level navigation Google itself redirects to, not a fetch() this
    // app's own JS ever reads) would land on a page showing the token in
    // the response body/URL bar. Redirecting to the web app instead keeps
    // the token off the visible page — it only ever travels via the
    // redirect's own query string, which the target pages strip
    // immediately (see auth/mfa's and auth/callback's own mount effects).
    if ('mfaRequired' in result) {
      const params = new URLSearchParams({
        token: result.mfaPendingToken,
        setup: result.mfaMethod ? 'false' : 'true',
        // TASKS_05 TASK 08 — now that there are 3 methods (email/totp/sms),
        // not 2, this can't be inferred from `setup` alone the way
        // app/auth/mfa/page.tsx's mount effect used to.
        ...(result.mfaMethod ? { method: result.mfaMethod } : {}),
      });
      res.redirect(`${FRONTEND_URL}/auth/mfa?${params}`);
      return;
    }

    // Unreachable while appConfig.MFA_REQUIRED is hardcoded `true`
    // (packages/config/app.ts) — loginWithGoogle() always resolves the
    // branch above in that case. Implemented anyway in case MFA_REQUIRED
    // ever becomes configurable. TokenPairResponse has `expiresIn`
    // (seconds), not an `expiresAt` timestamp — converting here since the
    // frontend's session model (and /auth/mfa/verify's own response
    // shape) expects an ISO string.
    const expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
    const params = new URLSearchParams({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt,
    });
    res.redirect(`${FRONTEND_URL}/auth/callback?${params}`);
  }

  // ── MFA ──────────────────────────────────────────────────────────────────

  @Get('mfa/setup')
  @UseGuards(AuthTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Begin MFA enrolment — returns a TOTP QR code or sends an SMS code' })
  async mfaSetup(@CurrentUser() authToken: AuthTokenPayload, @Query() query: MfaSetupQueryDto) {
    return this.authService.initiateMfaSetup(authToken.sub, authToken.email!, query);
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm the MFA code and complete enrolment — issues the full session' })
  async mfaVerify(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: MfaVerifyDto,
    @Req() req: Request,
  ) {
    return this.authService.completeMfaSetup(authToken.sub, authToken.email!, dto, req);
  }

  @Post('mfa/challenge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify an MFA code — completes a pending login, or re-authorises a sensitive action',
  })
  async mfaChallenge(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: MfaChallengeDto,
    @Req() req: Request,
  ) {
    return this.authService.challengeMfa(authToken, dto, req);
  }

  @Post('mfa/email/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend the email OTP code (rate-limited)' })
  async mfaEmailResend(@CurrentUser() authToken: AuthTokenPayload) {
    // BUG FIX — see resendPurposeFor()'s own doc comment (auth.service.ts).
    // This used to be an inline `authToken.purpose === 'mfa_setup' ?
    // 'mfa_change' : 'login'`, which silently fell through to 'login' for
    // an already-logged-in user switching MFA methods (a real 'access'
    // token, not 'mfa_setup') — a resent code during that flow was stored
    // under the wrong purpose and could never verify: 401 even with the
    // correct code.
    const purpose = resendPurposeFor(authToken.purpose);
    return this.authService.resendEmailOtp(authToken.sub, authToken.email!, purpose);
  }

  /**
   * TEMPORARY — see commit "debug: add MFA verification logging".
   * Unauthenticated by design (matches how it was specified) — only ever
   * meant to be reachable in dev/staging; 404s in production regardless
   * (see AuthService.debugMfaCode()). Remove this route and the service
   * method behind it once AUTH_MFA_INVALID_CODE's root cause is found.
   */
  @Get('mfa-debug')
  @ApiOperation({ summary: '[DEBUG, non-production only] Returns the currently-valid TOTP code for a user' })
  async mfaDebug(@Query('userId') userId: string) {
    return this.authService.debugMfaCode(userId);
  }

  /**
   * Support/dev tool, gated by a shared secret header rather than
   * NODE_ENV — see AuthService.resetMfaDev()'s own comment for why (it's
   * meant to be usable against a real account, not just dev/staging).
   * Powerful and dangerous if DEV_RESET_KEY ever leaks: whoever holds it
   * can silently disable MFA for any account by email alone. Treat it
   * like a credential — rotate it if it's ever exposed.
   */
  @Post('mfa/reset-dev')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Support/dev only] Reset MFA enrolment for an account, gated by X-Dev-Key' })
  async mfaResetDev(
    @Headers('x-dev-key') devKey: string | undefined,
    @Body() dto: MfaResetDevDto,
    @Req() req: Request,
  ) {
    if (!matchesDevResetKey(devKey)) {
      throw new UnauthorizedException('Invalid or missing X-Dev-Key');
    }
    return this.authService.resetMfaDev(dto, req);
  }

  @Post('mfa/recovery-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request an MFA recovery link (lost authenticator) — always responds the same whether or not the email exists',
  })
  async mfaRecoveryRequest(@Body() dto: MfaRecoveryRequestDto, @Req() req: Request) {
    return this.authService.requestMfaRecovery(dto, req);
  }

  @Post('mfa/recovery-verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete MFA recovery using the token from the emailed link — clears MFA and returns a setup pending token' })
  async mfaRecoveryVerify(@Body() dto: MfaRecoveryVerifyDto, @Req() req: Request) {
    return this.authService.verifyMfaRecovery(dto, req);
  }

  /**
   * TASKS_06 TASK 05 — password change for an already-logged-in user,
   * from the profile page's modal. Requires the caller's current MFA code
   * on the SAME request (X-MFA-Code header) via MfaChallengeGuard —
   * same "sensitive action re-challenge" pairing as the institution
   * admin/codes/verification-review routes. The frontend must call
   * POST /auth/mfa/email/resend first for an email-MFA account (no code
   * to submit otherwise); a TOTP-MFA account just reads its next code off
   * the authenticator app, no resend needed.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, MfaChallengeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password for the current session — requires MFA re-challenge (X-MFA-Code header)' })
  async changePassword(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.authService.changePassword(authToken.sub, dto.password, req);
  }

  // ── Session management ───────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new access + refresh token pair' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refreshTokens(dto, req);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidate the current session (or every session for this account)' })
  async logout(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: LogoutDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.logout(authToken, dto, req);
  }

  /** TASKS_06 TASK 08 P2a — distinct from POST /auth/logout {allDevices:true} (unused by the frontend today, left as-is): a dedicated route with the response shape the profile page's "Sign out all devices" confirm flow needs. */
  @Post('logout/all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every active session for this account' })
  async logoutAll(@CurrentUser() authToken: AuthTokenPayload, @Req() req: Request) {
    return this.authService.logoutAllDevices(authToken.sub, req);
  }

  /** TASKS_06 TASK 08 P2b — active sessions list for the profile page's "Active sessions" section. */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List every active session for this account' })
  async listSessions(@CurrentUser() authToken: AuthTokenPayload) {
    return this.authService.listSessions(authToken.sub, authToken.sessionId);
  }

  /** TASKS_06 TASK 08 P2b — revokes one specific session (e.g. "Revoke" on a device row that isn't the current one). */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke one specific session' })
  async revokeSession(@CurrentUser() authToken: AuthTokenPayload, @Param('sessionId') sessionId: string): Promise<void> {
    await this.authService.revokeSession(authToken.sub, sessionId);
  }

  // ── LinkedIn connect (profile enrichment, not login) ────────────────────

  @Post('linkedin/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Exchange a LinkedIn OAuth code for basic profile data (name, photo) — does not save anything' })
  async connectLinkedin(@Body() dto: LinkedinConnectDto) {
    const linkedinData = await this.authService.connectLinkedin(dto.code, dto.redirectUri);
    return { linkedinData };
  }
}
