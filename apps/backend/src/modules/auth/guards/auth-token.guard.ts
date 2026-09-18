/**
 * Verifies that a Bearer token was genuinely signed by this API and is not
 * expired — but, unlike JwtAuthGuard, accepts ANY token purpose (access,
 * refresh, mfa_setup, mfa_login). The decoded payload is attached to the
 * request as `req.authToken` for the route handler / service to inspect.
 *
 * This exists because the three /auth/mfa/* endpoints are deliberately
 * shared across several flows (first-time enrolment straight after signup,
 * completing a login for an already-enrolled account, and re-authorising a
 * sensitive action for a fully logged-in user) — each of those callers
 * presents a different token purpose. AuthService decides, per method,
 * which purposes it will actually act on; this guard's only job is proving
 * the token is authentic.
 */

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthTokenPayload } from '../auth.types';

@Injectable()
export class AuthTokenGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { authToken?: AuthTokenPayload }>();
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = header.slice('Bearer '.length);

    try {
      req.authToken = await this.jwtService.verifyAsync<AuthTokenPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
