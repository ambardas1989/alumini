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
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { MfaSetupQueryDto } from './dto/mfa-setup-query.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaChallengeDto } from './dto/mfa-challenge.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthTokenGuard } from './guards/auth-token.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthTokenPayload } from './auth.types';
import { GoogleProfile } from './strategies/google.strategy';

/**
 * IMPORTANT: Add FRONTEND_URL=https://alumtribe.com to Render environment
 * variables before testing Google OAuth on production. Without this, OAuth
 * redirects to localhost.
 */
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

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
}
