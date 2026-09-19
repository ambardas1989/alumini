'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from '@/lib/useTranslations';
import styles from './ClassroomHeader.module.css';

interface ClassroomHeaderProps {
  name: string;
  institutionName: string;
  batchYear: number;
  memberCount: number;
  teacherCount: number;
  verifiedCount: number;
  onStatsClick: () => void;
}

export function ClassroomHeader({
  name,
  institutionName,
  batchYear,
  memberCount,
  teacherCount,
  verifiedCount,
  onStatsClick,
}: ClassroomHeaderProps) {
  const router = useRouter();
  const t = useTranslations('classroom.header');
  const yearsSince = Math.max(0, new Date().getFullYear() - batchYear);

  return (
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={() => router.back()} aria-label={t('back')}>
        ←
      </button>
      <div className={styles.titleBlock}>
        <p className={styles.name}>{name}</p>
        <p className={styles.subtitle}>
          {institutionName} · {batchYear}
        </p>
      </div>
      <button type="button" className={styles.statsRow} onClick={onStatsClick}>
        <span>{t('members', { count: memberCount })}</span>
        <span>·</span>
        <span>{t('teachers', { count: teacherCount })}</span>
        <span>·</span>
        <span>{t('verified', { count: verifiedCount })}</span>
        <span>·</span>
        <span>{t('yearsSince', { years: yearsSince })}</span>
      </button>
    </header>
  );
}
