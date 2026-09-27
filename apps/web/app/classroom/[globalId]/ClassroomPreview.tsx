'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClassroomPreview as ClassroomPreviewData } from '@/lib/api';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate } from '@/lib/format';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { Button } from '@/components/ui/Button';
import styles from './ClassroomPreview.module.css';

interface ClassroomPreviewProps {
  globalId: string;
  preview: ClassroomPreviewData;
  isLoggedIn: boolean;
  /** Join succeeded (or the caller was already a member) — parent reloads into the full classroom view. */
  onJoined: () => void;
}

const FAKE_BUBBLE_COUNT = 4;

/** TASKS_09 TASK 18 — public share-link landing page for a non-member (logged in or not). */
export function ClassroomPreview({ globalId, preview, isLoggedIn, onJoined }: ClassroomPreviewProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const t = useTranslations('classroom.preview');
  const tEvents = useTranslations('classroom.events');
  const [joining, setJoining] = useState(false);

  const createdYear = new Date(preview.createdAt).getFullYear();

  const handleJoin = async () => {
    if (!isLoggedIn) {
      router.push(`/auth/signup?redirect=${encodeURIComponent(`/classroom/${globalId}`)}`);
      return;
    }
    setJoining(true);
    try {
      await api.joinClassroom(preview.id);
      if (preview.requiresVerification) {
        router.push(`/verify?classroomId=${preview.id}`);
      } else {
        onJoined();
      }
    } catch (err) {
      // Same "409 = already a member, treat as success" reasoning as the
      // full classroom page's own handleJoin() — see its comment.
      if (err instanceof ApiError && err.statusCode === 409) {
        onJoined();
      } else {
        showToast(getErrorMessage(err), 'error');
      }
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <p className={styles.name}>{preview.name}</p>
        {preview.institutionName && <p className={styles.institution}>{preview.institutionName}</p>}
        <p className={styles.meta}>
          {preview.city ? `📍 ${preview.city} · ` : ''}📅 {preview.batchYear}
        </p>
        <p className={styles.stats}>
          {t('verifiedMembers', { count: preview.verifiedCount })} · {t('estYear', { year: createdYear })}
        </p>
      </div>

      <div className={styles.blurSection}>
        <div className={styles.blurredBubbles} aria-hidden="true">
          {Array.from({ length: FAKE_BUBBLE_COUNT }).map((_, i) => (
            <div key={i} className={styles.fakeBubble} style={{ width: `${55 + (i % 3) * 15}%` }} />
          ))}
        </div>
        <div className={styles.blurOverlay}>
          <p>{t('joinToSeeConversations')}</p>
        </div>
      </div>

      {preview.upcomingEvents.length > 0 && (
        <div className={styles.eventsSection}>
          <p className={styles.sectionLabel}>{t('upcomingEvents')}</p>
          {preview.upcomingEvents.map((event) => (
            <div key={event.id} className={styles.eventTile}>
              <p className={styles.eventTitle}>{event.title}</p>
              <p className={styles.eventMeta}>
                🕐 {safeFormatDate(event.eventDate, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              </p>
              {(event.location || event.isOnline) && (
                <p className={styles.eventMeta}>📍 {event.isOnline ? tEvents('online') : event.location}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={styles.ctaSection}>
        <Button variant="primary" size="lg" fullWidth loading={joining} onClick={handleJoin}>
          {t('joinButton')}
        </Button>
        {!isLoggedIn && (
          <button
            type="button"
            className={styles.signInLink}
            onClick={() => router.push(`/auth/login?redirect=${encodeURIComponent(`/classroom/${globalId}`)}`)}
          >
            {t('signInPrompt')}
          </button>
        )}
      </div>
    </div>
  );
}
