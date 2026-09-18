'use client';

import { useTranslations } from '@/lib/useTranslations';
import styles from './LoadingSpinner.module.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';

interface LoadingSpinnerProps {
  size?: SpinnerSize;
  fullPage?: boolean;
}

export function LoadingSpinner({ size = 'md', fullPage = false }: LoadingSpinnerProps) {
  const t = useTranslations('common');
  const spinner = <div className={`${styles.spinner} ${styles[size]}`} role="status" aria-label={t('loading')} />;

  if (fullPage) {
    return <div className={styles.fullPage}>{spinner}</div>;
  }

  return spinner;
}
