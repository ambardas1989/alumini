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

/**
 * FIX 4 — was rendering the classroom name (e.g. "Grade 9A") as the bold
 * top line and cramming "{institutionName} · {batchYear}" into an
 * unprotected subtitle with no wrap/truncation guard, so a longer
 * institution name (e.g. "KV Fort William") wrapped word-by-word with the
 * "·" separator stranded on its own line. Institution name is now the
 * (truncated, single-line) top line; the classroom identity + batch year
 * moved to the subtitle, which now has the same nowrap/ellipsis guard.
 *
 * The old 4th stat ("{years}yr", e.g. "18yr") was ambiguous —
 * indistinguishable from a member-style count — and now-redundant with the
 * batch year already shown in the subtitle, so it's removed rather than
 * relabeled.
 */
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

  return (
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={() => router.back()} aria-label={t('back')}>
        ←
      </button>
      <div className={styles.titleBlock}>
        <p className={styles.name}>{institutionName}</p>
        <p className={styles.subtitle}>
          {t('classroomBatch', { name, year: batchYear })}
        </p>
      </div>
      <button type="button" className={styles.statsRow} onClick={onStatsClick}>
        <span>{t('members', { count: memberCount })}</span>
        <span>·</span>
        <span>{t('teachers', { count: teacherCount })}</span>
        <span>·</span>
        <span>{t('verified', { count: verifiedCount })}</span>
      </button>
      <button type="button" className={styles.detailsLink} onClick={onStatsClick}>
        ⓘ {t('details')}
      </button>
    </header>
  );
}
