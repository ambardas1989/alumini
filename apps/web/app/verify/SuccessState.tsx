'use client';

import { formatDate } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { Button } from '@/components/ui/Button';
import styles from './SuccessState.module.css';

interface SuccessStateProps {
  method: string | null;
  verifiedAt: string | null;
  onGoToClassroom: () => void;
}

export function SuccessState({ method, verifiedAt, onGoToClassroom }: SuccessStateProps) {
  const t = useTranslations('verification.success');

  return (
    <div className={styles.wrap}>
      <span className={styles.checkCircle} aria-hidden="true">
        ✓
      </span>
      <h1 className={styles.title}>{t('title')}</h1>
      {method && <p className={styles.method}>{t('viaMethod', { method })}</p>}
      {verifiedAt && <p className={styles.date}>{formatDate(verifiedAt)}</p>}
      <Button variant="primary" size="lg" fullWidth onClick={onGoToClassroom}>
        {t('goToClassroomButton')}
      </Button>
    </div>
  );
}
