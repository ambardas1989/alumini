'use client';

import { useEffect, useState } from 'react';
import styles from './OfflineBanner.module.css';

export function OfflineBanner() {
  // Starts `false` (matches SSR, where `navigator` doesn't exist) and is
  // corrected on mount — avoids a hydration mismatch from reading
  // navigator.onLine during the initial render.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);

    const handleOffline = () => setOffline(true);
    const handleOnline = () => setOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className={styles.banner} role="status">
      You are offline
    </div>
  );
}
