/**
 * Client-side session storage — a thin localStorage wrapper. Every function
 * checks `typeof window !== 'undefined'` first: this app's layout/pages
 * render on the server too, where `localStorage` doesn't exist, and Next.js
 * throws if you touch it unguarded during SSR.
 *
 * BUG FIX (TASKS_03 TASK 02): this used to be access-token-only, on the
 * premise that POST /auth/mfa/verify never returns a refresh token. It
 * always DID generate one server-side (AuthService.issueTokenPair()) — it
 * just wasn't included in the response body, so there was never anything
 * for the client to send back to POST /auth/refresh. Combined with
 * expiresAt being computed from the REFRESH token's multi-day lifetime
 * instead of the access token's real 15-minute one, the app never even
 * tried to refresh before the access token silently died — the actual root
 * cause of "session expired" appearing during completely normal use. Both
 * are fixed now (see LoginResponseDto), and a refresh token has a real,
 * persisted home here.
 */

const TOKEN_KEY = 'alumini_token';
const REFRESH_TOKEN_KEY = 'alumini_refresh_token';
const EXPIRY_KEY = 'alumini_token_expiry';
const USER_KEY = 'alumini_user';

/** Matches the `user` shape POST /auth/mfa/verify returns — see LoginResponseDto (apps/backend). */
export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  activePersona: string;
}

const REFRESH_THRESHOLD_MS = 5 * 60_000;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function getTokenExpiry(): Date | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(EXPIRY_KEY);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function setTokenExpiry(expiresAt: string): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(EXPIRY_KEY, expiresAt);
}

export function getCurrentUser(): User | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: User): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function isLoggedIn(): boolean {
  return getToken() !== null;
}

/** True once the access token is within 5 minutes of expiring (or already expired). */
export function shouldRefreshToken(): boolean {
  const expiry = getTokenExpiry();
  if (!expiry) return false;
  return expiry.getTime() - Date.now() <= REFRESH_THRESHOLD_MS;
}

export function clearSession(): void {
  clearToken();
  if (!isBrowser()) return;
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(EXPIRY_KEY);
  window.localStorage.removeItem(USER_KEY);
}

// ── Sign-out sequencing (TASKS_07 TASK 10) ──────────────────────────────
//
// Every sign-out path (AuthProvider.logout(), the profile page's "This
// device"/"All devices" buttons, useIdleTimeout's auto-expiry) used to
// clear the session then call router.push() — a CLIENT-SIDE navigation
// that doesn't unmount the current page/its effects immediately. Any
// polling effect still mounted (e.g. NotificationBell's unread-count
// interval) could fire again in that gap, either silently failing against
// the now-missing token or — worse — still holding the stale token in a
// closure from before clearSession() ran, getting a real 401 back from
// the now-revoked session, and tripping lib/api.ts's global 401 handler's
// OWN hard redirect (?message=session_expired) in a race against this
// intentional sign-out's redirect (?message=signed_out). window.location.href
// forces a full page reload, which immediately halts all JS on the page —
// no further requests can fire once navigation begins. isLoggingOut() is an
// extra guard for the brief window before that reload actually completes.

let loggingOut = false;

/** Read by lib/api.ts's request() to skip firing new calls once sign-out has started. */
export function isLoggingOut(): boolean {
  return loggingOut;
}

/**
 * Shared tail end of every sign-out path: mark isLoggingOut (stops further
 * API calls immediately, not just after the reload completes), clear the
 * session, then force a full page reload to /auth/login. Callers make
 * their own best-effort logout API call (POST /auth/logout or
 * /auth/logout/all) BEFORE calling this — this function itself never
 * fails, so it's always safe to call from a catch block.
 */
export function completeSignOut(message: 'signed_out' | 'session_expired' = 'signed_out'): void {
  loggingOut = true;
  clearSession();
  if (isBrowser()) {
    window.location.href = `/auth/login?message=${message}`;
  }
}
