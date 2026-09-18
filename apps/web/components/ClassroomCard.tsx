'use client';

import Link from 'next/link';
import type { VerificationStatus } from '@alumini/types';
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

const STATUS_BADGE: Record<VerificationStatus, { variant: BadgeVariant; label: string }> = {
  verified: { variant: 'verified', label: 'Verified' },
  pending: { variant: 'pending', label: 'Pending' },
  rejected: { variant: 'rejected', label: 'Rejected' },
};

export function ClassroomCard({ classroom, onTap, loading = false }: ClassroomCardProps) {
  if (loading) return <SkeletonCard />;

  const status = classroom.verificationStatus ? STATUS_BADGE[classroom.verificationStatus] : undefined;

  return (
    <Link
      href={`/classroom/${classroom.globalId}`}
      className={styles.card}
      onClick={() => onTap?.(classroom)}
    >
      {classroom.institution && <p className={styles.institution}>{classroom.institution.name}</p>}
      <p className={styles.name}>{classroom.name}</p>
      <div className={styles.row}>
        <span className={styles.stat}>
          {classroom.batchYear} &middot; {classroom.memberCount} member{classroom.memberCount === 1 ? '' : 's'}
        </span>
        {status && <Badge variant={status.variant} label={status.label} />}
      </div>
    </Link>
  );
}
