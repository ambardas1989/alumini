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
  verifiedCount: number;
  /** TASKS_09 TASK 15 FIX B — pending + pending_auto members; hidden entirely when 0. */
  pendingCount: number;
  /** TASKS_09 TASK 15 FIX B — classroom's own city, falling back to its institution's cityCode; hidden entirely when neither is available. */
  city?: string | null;
  /** FIX 3 — the CURRENT user's own role in this classroom, shown as a badge so they can tell why a channel is locked. */
  userRole: string | null;
  coverUrl?: string | null;
  /** TASKS_09 TASK 15 FIX C — widened from admin-only to any verified member + creator + admin. */
  canUploadCover: boolean;
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
  verifiedCount,
  pendingCount,
  city,
  userRole,
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
  const roleBadgeClass = userRole ? ROLE_BADGE_CLASS[userRole] : undefined;

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
      <div className={styles.titleBlock}>
        <p className={styles.name}>{institutionName}</p>
        {/* TASKS_09 TASK 15 FIX A — "Batch of {year}" dropped from here
            entirely; the batch year now shows once, as 📅 {year} in the
            stats row below, with no prefix/suffix. */}
        <p className={styles.subtitle}>{t('classroomIdentity', { identity })}</p>
      </div>
      {roleBadgeClass && (
        <span className={`${styles.roleBadge} ${styles[roleBadgeClass]}`}>{t(`role.${userRole}`)}</span>
      )}
      {/* TASKS_09 TASK 15 FIX B — icon+number stats only, dot-separated:
          members, verified, batch year, pending (only if >0), city (only
          if known). "(N years ago)" is removed entirely, not just hidden. */}
      <button
        type="button"
        className={styles.statsRow}
        onClick={onStatsClick}
        aria-label={t('statsRowLabel', { memberCount, verifiedCount, batchYear, pendingCount, city: city ?? '' })}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>{memberCount}</span>
        <span aria-hidden="true">·</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span>{verifiedCount}</span>
        <span aria-hidden="true">·</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>{batchYear}</span>
        {pendingCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>⏳ {pendingCount}</span>
          </>
        )}
        {city && (
          <>
            <span aria-hidden="true">·</span>
            <span>📍 {city}</span>
          </>
        )}
      </button>

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
