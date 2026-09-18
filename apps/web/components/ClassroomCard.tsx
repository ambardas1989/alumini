'use client';

import Link from 'next/link';
import type { VerificationStatus } from '@alumini/types';
import { useTranslations } from '@/lib/useTranslations';
import { Badge, type BadgeVariant } from './ui/Badge';
import { SkeletonCard } from './ui/SkeletonCard';
import styles from './ClassroomCard.module.css';

export interface ClassroomCardData {
  globalId: string;
  name: string;
  batchYear: number;
  memberCount: number;
  institution?: { name: string };
  verificationStatus?: VerificationStatus;
}

interface ClassroomCardProps {
  classroom: ClassroomCardData;
  onTap?: (classroom: ClassroomCardData) => void;
  loading?: boolean;
}

const STATUS_VARIANT: Record<VerificationStatus, BadgeVariant> = {
  verified: 'verified',
  pending: 'pending',
  rejected: 'rejected',
};

export function ClassroomCard({ classroom, onTap, loading = false }: ClassroomCardProps) {
  const tStatus = useTranslations('status');
  const tCard = useTranslations('classroom.card');

  if (loading) return <SkeletonCard />;

  const statusVariant = classroom.verificationStatus ? STATUS_VARIANT[classroom.verificationStatus] : undefined;

  return (
    <Link
      href={`/classroom/${classroom.globalId}`}
      className={styles.card}
      onClick={() => onTap?.(classroom)}
    >
      {classroom.institution && <p className={styles.institution}>{classroom.institution.name}</p>}
      <p className={styles.name}>{classroom.name}</p>
      <div className={styles.row}>
        {/* batchYear is a year, never thousands-formatted (formatNumber()
            would render "2,012", which no one writes for a class year) —
            memberCount goes through the ICU plural pattern below instead
            of formatNumber(), for the same reason as SessionExpiryWarning:
            next-intl formats the number itself while resolving the plural
            category, so it takes the raw number, not a pre-formatted string. */}
        <span className={styles.stat}>
          {classroom.batchYear} &middot; {tCard('memberCount', { count: classroom.memberCount })}
        </span>
        {statusVariant && <Badge variant={statusVariant} label={tStatus(statusVariant)} />}
      </div>
    </Link>
  );
}
