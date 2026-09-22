'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';
import { useTranslations } from '@/lib/useTranslations';
import styles from './ErrorMessage.module.css';

interface ErrorMessageProps {
  /** Usually a string; a ReactNode is accepted for the rare case of an inline link (e.g. "account exists — sign in instead?"). */
  message: ReactNode;
  fullPage?: boolean;
  onRetry?: () => void;
}

export function ErrorMessage({ message, fullPage = false, onRetry }: ErrorMessageProps) {
  const t = useTranslations('common');

  if (fullPage) {
    return (
      <div className={styles.fullPage}>
        <p className={styles.fullPageMessage}>{message}</p>
        {onRetry && (
          <Button variant="secondary" size="md" onClick={onRetry}>
            {t('retry')}
          </Button>
        )}
      </div>
    );
  }

  return <p className={styles.inline}>{message}</p>;
}
