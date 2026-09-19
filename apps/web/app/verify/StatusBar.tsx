'use client';

import { useTranslations } from '@/lib/useTranslations';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  status: 'notVerified' | 'pending' | 'verified';
  methodLabel?: string;
  onGoToClassroom: () => void;
}

export function StatusBar({ status, methodLabel, onGoToClassroom }: StatusBarProps) {
  const t = useTranslations('verification.statusBar');

  return (
    <div className={`${styles.bar} ${styles[status]}`}>
      {status === 'notVerified' && <span>{t('notVerified')}</span>}
      {status === 'pending' && <span>{t('pending', { method: methodLabel ?? '' })}</span>}
      {status === 'verified' && (
        <>
          <span>{t('verified', { method: methodLabel ?? '' })}</span>
          <button type="button" className={styles.goButton} onClick={onGoToClassroom}>
            {t('goToClassroom')}
          </button>
        </>
      )}
    </div>
  );
}
