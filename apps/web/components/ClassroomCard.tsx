'use client';

import Link from 'next/link';
import type { InstitutionType, VerificationStatus } from '@alumini/types';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from './ui/SkeletonCard';
import styles from './ClassroomCard.module.css';

export interface ClassroomCardData {
  globalId: string;
  name: string;
  batchYear: number;
  memberCount: number;
  institution?: { name: string; type?: InstitutionType };
  verificationStatus?: VerificationStatus;
}

interface ClassroomCardProps {
  classroom: ClassroomCardData;
  onTap?: (classroom: ClassroomCardData) => void;
  loading?: boolean;
}

/** TASKS_04 TASK 04 — school gets 🏫 on green, college/university gets 🎓 on purple; the mockup only names those two buckets. */
function institutionIcon(type: InstitutionType | undefined): { icon: string; bgClass: string } {
  if (type === 'school') return { icon: '🏫', bgClass: styles.iconSchool! };
  return { icon: '🎓', bgClass: styles.iconUniversity! };
}

export function ClassroomCard({ classroom, onTap, loading = false }: ClassroomCardProps) {
  const tStatus = useTranslations('status');
  const tCard = useTranslations('classroom.card');

  if (loading) return <SkeletonCard />;

  const { icon, bgClass } = institutionIcon(classroom.institution?.type);
  const isVerified = classroom.verificationStatus === 'verified' || classroom.verificationStatus === 'pending_auto';
  const isPending = classroom.verificationStatus === 'pending' || classroom.verificationStatus === 'rejected';

  return (
    <Link
      href={`/classroom/${classroom.globalId}`}
      className={styles.card}
      onClick={() => onTap?.(classroom)}
    >
      <div className={styles.row}>
        <span className={`${styles.icon} ${bgClass}`} aria-hidden="true">
          {icon}
        </span>
        <div className={styles.center}>
          <p className={styles.line1}>
            {classroom.institution ? `${classroom.institution.name} · ` : ''}
            {classroom.name} · {classroom.batchYear}
          </p>
          <p className={styles.line2}>{tCard('memberCount', { count: classroom.memberCount ?? 0 })}</p>
        </div>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </div>

      {/* TASKS_04 TASK 04's bottom row also wants a per-classroom unread-
          message count icon — no endpoint anywhere in this app tracks that
          (same "don't fabricate data" call the suggested-classrooms section
          below makes), so it's left out rather than showing a fake 0. */}
      {classroom.verificationStatus && (
        <div className={styles.bottomRow}>
          {isVerified ? (
            <span className={styles.verifiedPill}>✓ {tStatus('verified')}</span>
          ) : isPending ? (
            <span className={styles.pendingPill}>{tCard('verifyToEnter')}</span>
          ) : null}
        </div>
      )}
    </Link>
  );
}
