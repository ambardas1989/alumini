'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import styles from './ClassroomHeader.module.css';

interface ClassroomHeaderProps {
  classroomId: string;
  name: string;
  grade?: string | null;
  section?: string | null;
  program?: string | null;
  institutionName: string;
  /** TASKS_09 TASK 21 FIX A — picks the header's institution-icon emoji (🏫 school, 🎓 college/university), matching ClassroomCard's own institutionIcon() split. */
  institutionType?: string;
  batchYear: number;
  memberCount: number;
  verifiedCount: number;
  /** pending + pending_auto members. */
  pendingCount: number;
  userRole: string | null;
  coverUrl?: string | null;
  /** TASKS_09 TASK 15 FIX C — widened from admin-only to any verified member + creator + admin. */
  canUploadCover: boolean;
  onCoverUpdated: (coverUrl: string) => void;
  onStatsClick: () => void;
}

const ACCEPTED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_COVER_SIZE_BYTES = 10 * 1024 * 1024;

export function ClassroomHeader({
  classroomId,
  name,
  grade,
  section,
  program,
  institutionName,
  institutionType,
  batchYear,
  memberCount,
  verifiedCount,
  pendingCount,
  coverUrl,
  canUploadCover,
  onCoverUpdated,
  onStatsClick,
}: ClassroomHeaderProps) {
  const router = useRouter();
  const t = useTranslations('classroom.header');
  const { showToast } = useToast();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  const identity = grade ? `${grade}${section ?? ''}` : (program ?? name);
  const institutionIcon = institutionType === 'school' ? '🏫' : '🎓';

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen) return;

    if (!ACCEPTED_COVER_TYPES.includes(chosen.type)) {
      showToast(t('coverErrors.wrongType'), 'error');
      return;
    }
    if (chosen.size > MAX_COVER_SIZE_BYTES) {
      showToast(t('coverErrors.tooLarge'), 'error');
      return;
    }

    setUploadingCover(true);
    try {
      const result = await api.uploadClassroomCover(classroomId, chosen);
      onCoverUpdated(result.coverUrl);
      showToast(t('coverUpdatedToast'), 'success');
    } catch (err) {
      const statusCode = err instanceof ApiError ? err.statusCode : null;
      if (statusCode === 413) {
        showToast(t('coverErrors.tooLarge'), 'error');
      } else if (statusCode === 415) {
        showToast(t('coverErrors.wrongType'), 'error');
      } else if (statusCode === 403) {
        showToast(t('coverErrors.permissionDenied'), 'error');
      } else {
        showToast(t('coverErrors.uploadFailedGeneric'), 'error');
      }
    } finally {
      setUploadingCover(false);
    }
  };

  return (
    <header
      className={styles.header}
      style={
        coverUrl
          ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.7)), url(${coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : undefined
      }
    >
      <button type="button" className={styles.back} onClick={() => router.back()} aria-label={t('back')}>
        ←
      </button>
      <span className={styles.institutionIcon} aria-hidden="true">
        {institutionIcon}
      </span>
      <div className={styles.titleBlock}>
        {/* TASKS_09 TASK 21 FIX A — one line, matching the mockup exactly:
            "{institution} · {identity} · {year}", no separate subtitle row. */}
        <p className={styles.name}>
          {institutionName} · {identity} · {batchYear}
        </p>
        {/* Icon-only stats, space-separated (no dot separators, no city/
            batch-year duplication — batch year is already in the title
            line above). */}
        <button type="button" className={styles.statsRow} onClick={onStatsClick} aria-label={t('statsRowLabel', { memberCount, verifiedCount, pendingCount })}>
          <span>👥 {memberCount}</span>
          <span>✅ {verifiedCount}</span>
          <span>⏳ {pendingCount}</span>
        </button>
      </div>

      {canUploadCover && (
        <>
          <button
            type="button"
            className={styles.coverUploadButton}
            onClick={() => coverInputRef.current?.click()}
            disabled={uploadingCover}
            aria-label={t('changeCover')}
          >
            {uploadingCover ? <LoadingSpinner size="sm" /> : '📷'}
          </button>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={styles.hiddenInput}
            onChange={handleCoverFileChange}
          />
        </>
      )}
    </header>
  );
}
