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
  batchYear: number;
  memberCount: number;
  teacherCount: number;
  verifiedCount: number;
  /** FIX 3 — the CURRENT user's own role in this classroom, shown as a badge so they can tell why a channel is locked. */
  userRole: string | null;
  coverUrl?: string | null;
  onCoverUpdated: (coverUrl: string) => void;
  onStatsClick: () => void;
}

const ACCEPTED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_COVER_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * FIX 4 — was rendering the classroom name (e.g. "Grade 9A") as the bold
 * top line and cramming "{institutionName} · {batchYear}" into an
 * unprotected subtitle with no wrap/truncation guard, so a longer
 * institution name (e.g. "KV Fort William") wrapped word-by-word with the
 * "·" separator stranded on its own line. Institution name is now the
 * (truncated, single-line) top line; the subtitle is "Class {section} ·
 * Batch of {year}" for a school classroom (grade+section, e.g. "Class 12B
 * · Batch of 2008") or "{program} · Batch of {year}" for a college/
 * university one (no grade/section there) — either way nowrap/ellipsis
 * guarded like the name above it.
 *
 * The old 4th stat ("{years}yr", e.g. "18yr") was ambiguous —
 * indistinguishable from a member-style count — and now-redundant with the
 * batch year already shown in the subtitle, so it's removed rather than
 * relabeled.
 */
const ROLE_BADGE_CLASS: Record<string, string> = {
  admin: 'roleBadgeAdmin',
  teacher: 'roleBadgeTeacher',
  student: 'roleBadgeStudent',
};

export function ClassroomHeader({
  classroomId,
  name,
  grade,
  section,
  program,
  institutionName,
  batchYear,
  memberCount,
  teacherCount,
  verifiedCount,
  userRole,
  coverUrl,
  onCoverUpdated,
  onStatsClick,
}: ClassroomHeaderProps) {
  const router = useRouter();
  const t = useTranslations('classroom.header');
  const { showToast } = useToast();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  const identity = grade ? `${grade}${section ?? ''}` : (program ?? name);
  const roleBadgeClass = userRole ? ROLE_BADGE_CLASS[userRole] : undefined;
  const isAdmin = userRole === 'admin';

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
      style={coverUrl ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      <button type="button" className={styles.back} onClick={() => router.back()} aria-label={t('back')}>
        ←
      </button>
      <div className={styles.titleBlock}>
        <p className={styles.name}>{institutionName}</p>
        <p className={styles.subtitle}>
          {t('classroomBatch', { identity, year: batchYear })}
        </p>
      </div>
      {roleBadgeClass && (
        <span className={`${styles.roleBadge} ${styles[roleBadgeClass]}`}>{t(`role.${userRole}`)}</span>
      )}
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

      {isAdmin && (
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
