/**
 * Handles the Google OAuth redirect flow (GET /auth/google → Google consent
 * screen → GET /auth/google/callback). Registered under the name 'google'.
 *
 * This strategy only extracts the Google profile — it does not touch
 * Supabase or issue any tokens. AuthController.googleCallback() hands the
 * validated profile to AuthService.loginWithGoogle(), which does the
 * account lookup/creation and MFA gating shared with the password login flow.
 */

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, StrategyOptions, VerifyCallback, Profile } from 'passport-google-oauth20';

export interface GoogleProfile {
  googleId: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
}

/**
 * Whether all three Google OAuth env vars are present. AuthModule uses this
 * to decide whether to register GoogleStrategy as a provider at all (so its
 * constructor — which requires a non-empty clientID/clientSecret/callbackURL,
 * per passport-oauth2 — is never invoked when they're missing, e.g. on a
 * fresh Render deploy before OAuth credentials are configured) and
 * GoogleAuthGuard uses it to fail the /auth/google routes cleanly with a 503
 * instead of ever reaching passport for a strategy that was never registered.
 */
export function isGoogleOAuthConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL
  );
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
      scope: ['email', 'profile'],
    } as StrategyOptions);
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;

    if (!email) {
      done(new Error('Google account has no accessible email address'), false);
      return;
    }

    const googleProfile: GoogleProfile = {
      googleId: profile.id,
      email,
      fullName: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value,
    };

    done(null, googleProfile);
  }
}
