'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import {
  clearSession,
  getCurrentUser,
  isLoggedIn as checkIsLoggedIn,
  setCurrentUser,
  setToken,
  setTokenExpiry,
  shouldRefreshToken,
  type User,
} from '@/lib/auth';

/** The session data a completed login (POST /auth/mfa/verify or /challenge) produces — see api.LoginResponse. */
interface Session {
  accessToken: string;
  expiresAt: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  isLoggedIn: boolean;
  login: (session: Session) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const REFRESH_CHECK_INTERVAL_MS = 60_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // Existing session, if any — read once on mount (localStorage doesn't exist during SSR).
  useEffect(() => {
    setUser(getCurrentUser());
    setReady(true);
  }, []);

  const login = useCallback((session: Session) => {
    setToken(session.accessToken);
    setTokenExpiry(session.expiresAt);
    setCurrentUser(session.user);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Best-effort — the local session is cleared either way below.
    }
    clearSession();
    setUser(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login';
    }
  }, []);

  // Silent refresh — checked every minute, only acted on once the access
  // token is actually within 5 minutes of expiring (shouldRefreshToken()).
  useEffect(() => {
    const interval = setInterval(() => {
      if (!checkIsLoggedIn() || !shouldRefreshToken()) return;

      api
        .refreshToken()
        .then((refreshed) => {
          setToken(refreshed.accessToken);
          setTokenExpiry(refreshed.expiresAt);
        })
        .catch(() => {
          clearSession();
          setUser(null);
          if (typeof window !== 'undefined') {
            window.location.href = '/auth/login?message=session_expired';
          }
        });
    }, REFRESH_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoggedIn: user !== null, login, logout }),
    [user, login, logout],
  );

  // Avoids a flash of logged-out UI while the localStorage check above runs.
  if (!ready) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
