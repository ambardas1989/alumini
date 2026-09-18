/**
 * Wraps AuthGuard('google') with an up-front configuration check. When
 * GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL aren't set, AuthModule never
 * registers GoogleStrategy with passport at all (see google.strategy.ts) —
 * calling super.canActivate() in that state would throw an unhandled
 * "Unknown authentication strategy" error. Checking first lets /auth/google
 * fail cleanly with a 503 instead.
 */

import { ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isGoogleOAuthConfigured } from '../strategies/google.strategy';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  canActivate(context: ExecutionContext) {
    if (!isGoogleOAuthConfigured()) {
      throw new ServiceUnavailableException({
        message: 'Google OAuth not configured',
        error: 'OAUTH_NOT_CONFIGURED',
      });
    }
    return super.canActivate(context);
  }
}
