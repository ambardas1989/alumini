/**
 * Internal types for the auth module.
 *
 * These are deliberately NOT exported from @alumini/types — they describe
 * this module's own JWT payload shape and HTTP response shapes, not
 * cross-module domain entities.
 */

import { MfaMethod } from '@alumini/types';

/**
 * Every JWT this module issues carries a `purpose`. A token is only ever
 * honoured for the endpoints that expect its specific purpose:
 *
 *   access     — full session credential, required by protected routes
 *   refresh    — exchanged at POST /auth/refresh for a new access/refresh pair
 *   mfa_setup  — issued after signup, or after login for an account that has
 *                never completed MFA enrolment. Only valid against
 *                GET /auth/mfa/setup and POST /auth/mfa/verify.
 *   mfa_login  — issued after a correct password/Google login for an account
 *                that already has MFA enabled. Only valid against
 *                POST /auth/mfa/challenge, and only completes a login there.
 *   mfa_reauth — not a distinct token; a full `access` token presented to
 *                POST /auth/mfa/challenge is treated as a sensitive-action
 *                re-challenge (SPEC.md §11.2) rather than a login completion.
 */
export type TokenPurpose = 'access' | 'refresh' | 'mfa_setup' | 'mfa_login';

export interface AuthTokenPayload {
  /** Supabase auth.users / profiles id */
  sub: string;
  email?: string;
  purpose: TokenPurpose;
  /** Present on access + refresh tokens only — ties the token to a sessions row */
  sessionId?: string;
}

export interface AuthUserSummary {
  id: string;
  email: string;
  fullName: string;
  mfaEnabled: boolean;
}

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds, for clients that schedule their own refresh */
  expiresIn: number;
  user: AuthUserSummary;
}

export interface MfaRequiredResponse {
  mfaRequired: true;
  /** Short-lived token — send as Bearer auth to the /auth/mfa/* endpoints */
  mfaPendingToken: string;
  /** Null when the account has not completed MFA enrolment yet */
  mfaMethod: MfaMethod | null;
}

export interface MfaSetupTotpResponse {
  // Narrows to the single literal, not the whole MfaMethod union — written
  // as the raw string literal type rather than `MfaMethod.TOTP` because
  // MfaMethod is now a const object + union type (Node's native TS
  // stripping doesn't support real `enum`, see packages/types/index.ts),
  // and dotting into a single member's TYPE only works for real enums.
  method: 'totp';
  /** data: URL — render directly in an <img> tag for the authenticator app to scan */
  qrCodeDataUrl: string;
  /** Same secret encoded in the QR code, for manual entry */
  secret: string;
}

export interface MfaSetupSmsResponse {
  method: 'sms'; // see MfaSetupTotpResponse's comment on why not MfaMethod.SMS
  /** Masked, e.g. +91******3210 — never echo the full number back */
  phone: string;
  expiresInSeconds: number;
}

export interface MfaVerifiedResponse {
  verified: true;
}
