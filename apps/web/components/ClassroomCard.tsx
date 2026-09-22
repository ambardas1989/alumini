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
  /** cityCode, not a resolved city name — this app has no code→name lookup, so it's shown as-is, same as ClassroomCreateForm's institution picker already does. */
  institution?: { name: string; type?: InstitutionType; cityCode?: string };
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
  const tCard = useTranslations('classroom.card');

  if (loading) return <SkeletonCard />;

  const { icon, bgClass } = institutionIcon(classroom.institution?.type);
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
        </div>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </div>

      {/* TASKS_05 TASK 04 — clear icon+label stats instead of ambiguous
          ticks. A per-classroom unread-message count (💬 in the original
          mockup) is left out — no endpoint anywhere in this app tracks
          that, same "don't fabricate data" call this component's previous
          revision already made. */}
      <div className={styles.bottomRow}>
        {isPending ? (
          <span className={styles.pendingPill}>{tCard('verifyToEnter')}</span>
        ) : (
          <>
            <span className={styles.statItem}>
              <UsersIcon />
              {tCard('memberCount', { count: classroom.memberCount ?? 0 })}
            </span>
            {classroom.institution?.cityCode && (
              <>
                <span className={styles.statSep} aria-hidden="true">
                  ·
                </span>
                <span className={styles.statItem}>
                  <PinIcon />
                  {classroom.institution.cityCode}
                </span>
              </>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

function UsersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
