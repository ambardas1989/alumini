/**
 * Client-side session storage — a thin localStorage wrapper. Every function
 * checks `typeof window !== 'undefined'` first: this app's layout/pages
 * render on the server too, where `localStorage` doesn't exist, and Next.js
 * throws if you touch it unguarded during SSR.
 *
 * Deliberately just three keys, access-token-only: POST /auth/mfa/verify —
 * this app's session-establishing endpoint — does not return a refresh
 * token (see apps/backend LoginResponseDto). There is nothing to persist
 * for a refresh flow beyond the access token's own expiry.
 */

const TOKEN_KEY = 'alumini_token';
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
  window.localStorage.removeItem(EXPIRY_KEY);
  window.localStorage.removeItem(USER_KEY);
}
