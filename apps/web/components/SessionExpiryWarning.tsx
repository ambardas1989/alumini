'use client';

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { clearSession, getTokenExpiry, setToken, setTokenExpiry } from '@/lib/auth';
import { Button } from './ui/Button';
import styles from './SessionExpiryWarning.module.css';

const CHECK_INTERVAL_MS = 60_000;
const WARNING_THRESHOLD_MS = 5 * 60_000;

export function SessionExpiryWarning() {
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const check = () => {
      const expiry = getTokenExpiry();
      if (!expiry) {
        setMinutesLeft(null);
        return;
      }
      const msLeft = expiry.getTime() - Date.now();
      setMinutesLeft(msLeft > 0 && msLeft <= WARNING_THRESHOLD_MS ? Math.ceil(msLeft / 60_000) : null);
    };

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const handleStayLoggedIn = useCallback(async () => {
    setRefreshing(true);
    try {
      const refreshed = await api.refreshToken();
      setToken(refreshed.accessToken);
      setTokenExpiry(refreshed.expiresAt);
      setMinutesLeft(null);
    } catch {
      clearSession();
      if (typeof window !== 'undefined') {
        window.location.href = '/auth/login?message=session_expired';
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearSession();
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login';
    }
  }, []);

  if (minutesLeft === null) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="session-expiry-title">
      <div className={styles.modal}>
        <h2 id="session-expiry-title" className={styles.title}>
          Session expiring soon
        </h2>
        <p className={styles.message}>
          Your session expires in {minutesLeft} minute{minutesLeft === 1 ? '' : 's'}.
        </p>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={handleLogout}>
            Log out
          </Button>
          <Button variant="primary" size="md" loading={refreshing} onClick={handleStayLoggedIn}>
            Stay logged in
          </Button>
        </div>
      </div>
    </div>
  );
}
