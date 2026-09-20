'use client';

import Link from 'next/link';
import { useTranslations } from '@/lib/useTranslations';
import type { TeacherClassroom } from './types';
import styles from './ClassRow.module.css';

interface ClassRowProps {
  classroom: TeacherClassroom;
}

export function ClassRow({ classroom }: ClassRowProps) {
  const t = useTranslations('teacherHome');

  return (
    <Link href={`/classroom/${classroom.globalId}`} className={styles.row}>
      <span className={`${styles.dot} ${classroom.isActive ? styles.dotActive : styles.dotAlumni}`} aria-hidden="true" />
      <span className={`${styles.name} ${classroom.isActive ? styles.nameActive : styles.nameAlumni}`}>
        {classroom.name}
      </span>
      <span className={styles.meta}>
        {t('memberCount', { count: classroom.memberCount ?? 0 })}
      </span>
      <span className={`${styles.badge} ${classroom.isActive ? styles.badgeActive : styles.badgeAlumni}`}>
        {classroom.isActive ? t('activeBadge') : t('alumniBadge')}
      </span>
    </Link>
  );
}
