'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { useAuth } from '@/components/providers/AuthProvider';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARN_BEFORE_MS = 2 * 60 * 1000; // warn 2 min before
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

/**
 * TASKS_06 TASK 08 — idle-session timeout. Only runs while logged in (per
 * the task's explicit requirement); both timers are cleared and every
 * activity listener removed the moment that stops being true, whether from
 * an explicit sign-out or the auto-expiry below firing.
 *
 * The auto-expiry path deliberately does NOT reuse AuthProvider.logout() —
 * that redirects with ?message=signed_out (a deliberate action), while an
 * idle timeout is closer to what the global 401 handler in lib/api.ts
 * already treats as ?message=session_expired. Both paths still best-effort
 * call api.logout() and clearSession() the same way.
 */
export function useIdleTimeout(): {
  showWarning: boolean;
  warningSecondsLeft: number;
  staySignedIn: () => void;
  signOutNow: () => void;
} {
  const { isLoggedIn, logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [warningSecondsLeft, setWarningSecondsLeft] = useState(Math.floor(WARN_BEFORE_MS / 1000));

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirrors showWarning for the activity listener's closure below — that
  // listener is attached once per isLoggedIn change (see the effect's own
  // comment on why), so it needs a ref, not the state value, to see
  // showWarning's latest value without having to reattach on every change.
  const showWarningRef = useRef(false);

  const clearAllTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    idleTimerRef.current = null;
    warnTimerRef.current = null;
    countdownIntervalRef.current = null;
  }, []);

  const expireSession = useCallback(async () => {
    clearAllTimers();
    setShowWarning(false);
    try {
      await api.logout();
    } catch {
      // Best-effort — same reasoning as AuthProvider.logout()/profile page's handleSignOut().
    }
    clearSession();
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login?message=session_expired';
    }
  }, [clearAllTimers]);

  const resetTimer = useCallback(() => {
    clearAllTimers();
    showWarningRef.current = false;
    setShowWarning(false);
    setWarningSecondsLeft(Math.floor(WARN_BEFORE_MS / 1000));

    warnTimerRef.current = setTimeout(() => {
      showWarningRef.current = true;
      setShowWarning(true);
      let secondsLeft = Math.floor(WARN_BEFORE_MS / 1000);
      countdownIntervalRef.current = setInterval(() => {
        secondsLeft -= 1;
        setWarningSecondsLeft(Math.max(secondsLeft, 0));
      }, 1000);
    }, IDLE_TIMEOUT_MS - WARN_BEFORE_MS);

    idleTimerRef.current = setTimeout(() => {
      void expireSession();
    }, IDLE_TIMEOUT_MS);
  }, [clearAllTimers, expireSession]);

  useEffect(() => {
    if (!isLoggedIn) {
      clearAllTimers();
      setShowWarning(false);
      return;
    }

    resetTimer();

    const handleActivity = () => {
      // While the warning is showing, activity alone shouldn't silently
      // dismiss it — the user must explicitly choose "Stay signed in" so
      // they consciously confirm they're still there, matching the task's
      // own two explicit buttons rather than any mouse jiggle resetting it.
      if (showWarningRef.current) return;
      resetTimer();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      clearAllTimers();
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const staySignedIn = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  const signOutNow = useCallback(() => {
    clearAllTimers();
    setShowWarning(false);
    void logout();
  }, [clearAllTimers, logout]);

  return { showWarning, warningSecondsLeft, staySignedIn, signOutNow };
}
