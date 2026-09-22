/**
 * Short-lived handoff between login()/signup() and the MFA screen
 * (app/auth/mfa/page.tsx). login()/signup() only return an mfaPendingToken
 * — a full session doesn't exist until the MFA step completes — so this is
 * where that token waits in between.
 *
 * sessionStorage, not localStorage: an mfaPendingToken is single-use, valid
 * for only appConfig.MFA_PENDING_TOKEN_EXPIRY_MINUTES (10 minutes), and
 * scoped to this one browser tab's auth attempt. It shouldn't survive
 * closing the tab, and — unlike the real session in lib/auth.ts — there's
 * no reason for it to. (The task's own instructions mention "URL param or
 * localStorage flag" as the two options for carrying MFA state to this
 * screen; sessionStorage was chosen instead of either — a URL query param
 * would leak this token into browser history, and localStorage would
 * needlessly outlive the tab for a token that's dead in 10 minutes anyway.)
 */

const PENDING_TOKEN_KEY = 'alumini_mfa_pending_token';
const PENDING_METHOD_KEY = 'alumini_mfa_pending_method';

export interface MfaPendingSession {
  token: string;
  /** null → account has never completed MFA enrolment (setup flow). A method → already enrolled (verify flow). */
  method: 'totp' | 'sms' | 'email' | null;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function setMfaPendingSession(session: MfaPendingSession): void {
  if (!isBrowser()) return;
  window.sessionStorage.setItem(PENDING_TOKEN_KEY, session.token);
  window.sessionStorage.setItem(PENDING_METHOD_KEY, session.method ?? '');
}

export function getMfaPendingSession(): MfaPendingSession | null {
  if (!isBrowser()) return null;
  const token = window.sessionStorage.getItem(PENDING_TOKEN_KEY);
  if (!token) return null;
  const rawMethod = window.sessionStorage.getItem(PENDING_METHOD_KEY);
  const method = rawMethod === 'totp' || rawMethod === 'sms' || rawMethod === 'email' ? rawMethod : null;
  return { token, method };
}

export function clearMfaPendingSession(): void {
  if (!isBrowser()) return;
  window.sessionStorage.removeItem(PENDING_TOKEN_KEY);
  window.sessionStorage.removeItem(PENDING_METHOD_KEY);
}
