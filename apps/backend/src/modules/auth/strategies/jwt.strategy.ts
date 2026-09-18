/**
 * Validates the standard `Authorization: Bearer <accessToken>` header used
 * by every protected route in the app. Registered under the name 'jwt' and
 * driven by JwtAuthGuard.
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthTokenPayload } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  /**
   * Runs after passport-jwt has already verified the signature and expiry.
   * We still reject anything that isn't a full 'access' token — a leaked
   * mfa_setup or mfa_login pending token must never grant access to a
   * protected resource, even though it carries a valid signature.
   */
  async validate(payload: AuthTokenPayload): Promise<AuthTokenPayload> {
    if (payload.purpose !== 'access') {
      throw new UnauthorizedException('This endpoint requires a fully authenticated session');
    }
    return payload;
  }
}
