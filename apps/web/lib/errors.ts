/**
 * Maps packages/types ErrorCode values to copy a user should actually see.
 * Never surfaces a raw API message — those are written for logs/debugging,
 * not the UI (e.g. Supabase's own error strings can leak internal detail).
 */

import { ApiError } from './api';

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: 'Incorrect email or password.',
  AUTH_ACCOUNT_NOT_FOUND: 'Incorrect email or password.',
  AUTH_RATE_LIMITED: 'Too many attempts. Please wait a few minutes.',
  AUTH_MFA_INVALID_CODE: 'Incorrect code. Please try again.',
  AUTH_MFA_EXPIRED: 'Your session expired. Please log in again.',
  AUTH_MFA_MAX_ATTEMPTS: 'Too many incorrect attempts. Please log in again.',
  AUTH_ACCOUNT_SUSPENDED: 'Your account has been suspended. Contact support.',
  AUTH_SESSION_EXPIRED: 'Your session expired. Please log in again.',
  VERIFICATION_OTP_INVALID: 'Incorrect code. Please try again.',
  VERIFICATION_OTP_EXPIRED: 'This code has expired. Request a new one.',
  VERIFICATION_OTP_MAX_ATTEMPTS: 'Too many attempts. This code is now invalid.',
  VERIFICATION_CODE_INVALID: 'Invalid or unrecognised code.',
  VERIFICATION_CODE_EXPIRED: 'This code has expired.',
  VERIFICATION_CODE_REDEEMED: 'This code has already been used.',
  CLASSROOM_DUPLICATE: 'This classroom already exists.',
  CLASSROOM_NOT_MEMBER: 'You are not a member of this classroom.',
  CHANNEL_ACCESS_DENIED: 'You do not have access to this channel.',
  OAUTH_NOT_CONFIGURED: 'Google sign-in is not available right now.',
};

const GENERIC_FALLBACK = 'Something went wrong. Please try again.';

/** Returns a mapped, user-facing message for an ApiError — never the raw API string. */
export function getErrorMessage(error: ApiError | unknown): string {
  if (error instanceof ApiError && error.errorCode) {
    return ERROR_MESSAGES[error.errorCode] ?? GENERIC_FALLBACK;
  }
  return GENERIC_FALLBACK;
}
