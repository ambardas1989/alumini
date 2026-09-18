'use client';

import { useEffect } from 'react';
import { useTranslations } from '@/lib/useTranslations';
import styles from './Toast.module.css';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  variant: ToastVariant;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4000;

export function Toast({ message, variant, onDismiss }: ToastProps) {
  const t = useTranslations('common');

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className={`${styles.toast} ${styles[variant]}`} role="status" aria-live="polite">
      <span className={styles.message}>{message}</span>
      <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label={t('dismissNotification')}>
        ×
      </button>
    </div>
  );
}
