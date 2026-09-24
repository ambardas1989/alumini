/**
 * Validates the standard `Authorization: Bearer <accessToken>` header used
 * by every protected route in the app. Registered under the name 'jwt' and
 * driven by JwtAuthGuard.
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AuthTokenPayload } from '../auth.types';
import { AuthService } from '../auth.service';
import { AppLogger } from '../../../common/logger/logger.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly appLogger: AppLogger;

  constructor(
    private readonly authService: AuthService,
    appLogger: AppLogger,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
      passReqToCallback: true,
    });
    this.appLogger = appLogger.setContext('AUTH');
  }

  /**
   * Runs after passport-jwt has already verified the signature and expiry.
   * We still reject anything that isn't a full 'access' token — a leaked
   * mfa_setup or mfa_login pending token must never grant access to a
   * protected resource, even though it carries a valid signature.
   *
   * TASKS_06 TASK 08 P1 — also checks the session behind this token is
   * still active (not revoked by logout()/logoutAllDevices()/
   * enforceDeviceLimit(), and not past its own expiry). Before this, a
   * signature/expiry-valid access token kept working for its full
   * lifetime even after the session it belonged to had been revoked —
   * logout() already correctly set sessions.revoked_at, but nothing on
   * the request path ever consulted it. See AuthService.validateSession()
   * for the lookup itself.
   */
  async validate(req: Request, payload: AuthTokenPayload): Promise<AuthTokenPayload> {
    if (payload.purpose !== 'access') {
      throw new UnauthorizedException('This endpoint requires a fully authenticated session');
    }

    const sessionActive = await this.authService.validateSession(payload.sessionId, payload.sub);
    if (!sessionActive) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    // TASKS_06 TASK 08 P3 — device fingerprinting for forensics/debugging
    // only, log-only, never blocks or restricts the request.
    this.appLogger.debug('[AUTH:fingerprint]', {
      userId: payload.sub,
      userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 100) ?? null,
      ip: (req.headers['x-forwarded-for'] as string | undefined) ?? req.socket?.remoteAddress ?? null,
      referer: req.headers['referer'] ?? null,
      sessionId: payload.sessionId,
    });

    return payload;
  }
}
