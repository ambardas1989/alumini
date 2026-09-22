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
  AUTH_ACCOUNT_EXISTS: 'An account with this email already exists.',
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
  MESSAGES_LOAD_FAILED: 'Could not load messages right now.',
  PROFILE_NOT_FOUND: 'Unable to load your profile. Please try again.',
  OAUTH_NOT_CONFIGURED: 'Google sign-in is not available right now.',
};

const GENERIC_FALLBACK = 'Something went wrong. Please try again.';
const SERVER_ERROR_FALLBACK = 'Server error. Please try again.';
const NETWORK_ERROR_FALLBACK = 'Connection issue. Check your internet.';

/**
 * Returns a mapped, user-facing message for an ApiError — never the raw
 * API string. FIX 3E — beyond the known ErrorCode map, falls back by
 * status class rather than always the same generic string:
 * - statusCode 0 (network/timeout failure, set in lib/api.ts's request()
 *   catch block): that ApiError's own .message is already a specific,
 *   user-safe string ("Could not reach the server...", "Request timed
 *   out...") — never the generic fallback.
 * - 5xx: a distinct "try again in a moment" message — this is the app's
 *   fault, not the user's input.
 * - 409: the backend always hand-writes 409 messages as user-safe copy
 *   (e.g. "A similar institution already exists: X.") — never a
 *   class-validator array — so it's safe to show directly.
 * - 400: class-validator's array-of-field-errors (e.g. "q must be a
 *   string") is NEVER safe to show verbatim — stays the generic fallback
 *   unless a specific errorCode was mapped above.
 */
export function getErrorMessage(error: ApiError | unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_FALLBACK;

  if (error.errorCode && ERROR_MESSAGES[error.errorCode]) {
    return ERROR_MESSAGES[error.errorCode]!;
  }
  if (error.statusCode === 0) {
    return error.message || NETWORK_ERROR_FALLBACK;
  }
  if (error.statusCode >= 500) {
    return SERVER_ERROR_FALLBACK;
  }
  if (error.statusCode === 409) {
    return error.message || GENERIC_FALLBACK;
  }
  return GENERIC_FALLBACK;
}

/**
 * FIX 5E — "400 validation array → parse and show per field." class-
 * validator's default messages all start with the DTO property name
 * (e.g. "countryCode must be exactly 2 characters"), so the leading word
 * is a reliable field key to group by. Returns {} for anything that isn't
 * an array (a single hand-written string message, or no payload at all) —
 * callers fall back to a single generic message in that case.
 */
export function parseValidationErrors(error: ApiError | unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.statusCode !== 400) return {};
  const payload = error.payload as { message?: unknown } | undefined;
  if (!payload || !Array.isArray(payload.message)) return {};

  const result: Record<string, string> = {};
  for (const raw of payload.message) {
    if (typeof raw !== 'string') continue;
    const field = raw.split(' ')[0];
    if (field) result[field] = raw;
  }
  return result;
}
