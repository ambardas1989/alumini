'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Classroom, Institution, VerificationStatus } from '@alumini/types';
import * as api from '@/lib/api';
import type { NotificationRow } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeRelativeTime } from '@/lib/format';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { UserMenu } from '@/components/UserMenu';
import { NotificationBell } from '@/components/NotificationBell';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ClassroomCard, type ClassroomCardData } from '@/components/ClassroomCard';
import styles from './page.module.css';

const NUDGE_DISMISSED_KEY = 'alumtribe_verify_nudge_dismissed';

interface FlatClassroom extends Classroom {
  institution: Institution;
  verificationStatus: VerificationStatus;
}

function flatten(
  groups: Array<{ institution: Institution; classes: Array<Classroom & { verificationStatus: string }> }>,
): FlatClassroom[] {
  return groups.flatMap((group) => group.classes.map((c) => ({ ...c, institution: group.institution }) as FlatClassroom));
}

type DateGroup = 'today' | 'yesterday' | 'earlier';

function dateGroupOf(iso: string): DateGroup {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return 'earlier';
}

/**
 * Maps a notification's `type` (NotificationService's @OnEvent() handlers —
 * see apps/backend notification.service.ts) to a feed item's accent/icon.
 * Only the types this backend actually emits are handled — new_message,
 * new_member, and vouch_request notification types don't exist yet (no
 * @OnEvent() handler emits them), so they're not faked here; the corridor/
 * membership modules would need their own notification events added first.
 */
function feedAccent(type: string): { icon: string; accent?: 'success' } {
  if (type.startsWith('verification')) return { icon: '✓', accent: 'success' };
  if (type === 'event.created') return { icon: '📅' };
  return { icon: '🔔' };
}

export default function HomePage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const t = useTranslations('home');
  const tCommon = useTranslations('common');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<FlatClassroom[]>([]);
  const [feed, setFeed] = useState<NotificationRow[]>([]);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setNudgeDismissed(!!window.sessionStorage.getItem(NUDGE_DISMISSED_KEY));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [myClassrooms, notifications] = await Promise.all([
        api.getMyClassrooms(),
        api.getNotifications(20),
      ]);
      setClassrooms(flatten(myClassrooms));
      setFeed(notifications);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const dismissNudge = () => {
    window.sessionStorage.setItem(NUDGE_DISMISSED_KEY, '1');
    setNudgeDismissed(true);
  };

  const firstPending = classrooms.find((c) => c.verificationStatus === 'pending');

  const handleFeedItemTap = (item: NotificationRow) => {
    const classroomId = (item.data?.classroom_id as string | undefined) ?? null;
    if (classroomId) {
      router.push(`/classroom/${classroomId}`);
    }
  };

  if (!ready) return null;

  return (
    <AppShell>
      <div className={styles.topBar}>
        <UserMenu size="md" showOnlineDot />
        <div className={styles.topBarText}>
          <h1 className={styles.greeting}>{t('title')}</h1>
          <p className={styles.subtitle}>{user?.fullName}</p>
        </div>
        <NotificationBell />
      </div>

      {firstPending && !nudgeDismissed && (
        <div className={styles.nudgeBanner}>
          <button
            type="button"
            className={styles.nudgeAction}
            onClick={() => router.push(`/verify?classroomId=${firstPending.id}`)}
          >
            {t('verificationNudge')}
          </button>
          <button
            type="button"
            className={styles.nudgeDismiss}
            aria-label={tCommon('dismiss')}
            onClick={dismissNudge}
          >
            ×
          </button>
        </div>
      )}

      <PageContainer>
        {error && <ErrorMessage message={error} onRetry={load} />}

        {!error && (
          <>
            {loading && (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}

            {/* TASKS_04 TASK 04 — the mockup's home screen is a classroom
                list (ACTIVE CLASSROOMS), not an activity feed; classrooms
                now render unconditionally here instead of only when the
                feed happened to be empty. The feed (a real, working
                notifications feature from earlier work) stays as its own
                section below rather than being deleted outright. */}
            {!loading && feed.length === 0 && classrooms.length === 0 && (
              <EmptyState
                icon="🎓"
                title={t('empty.title')}
                description={t('empty.description')}
                ctaLabel={t('empty.cta')}
                onCta={() => router.push('/classes')}
              />
            )}

            {!loading && classrooms.length > 0 && (
              <>
                <p className="section-heading">{t('activeClassrooms')}</p>
                {classrooms.map((classroom) => (
                  <ClassroomCard
                    key={classroom.id}
                    classroom={
                      {
                        globalId: classroom.globalId,
                        name: classroom.name,
                        batchYear: classroom.batchYear,
                        memberCount: classroom.memberCount,
                        institution: { name: classroom.institution.name, type: classroom.institution.type, cityCode: classroom.institution.cityCode },
                        verificationStatus: classroom.verificationStatus,
                      } satisfies ClassroomCardData
                    }
                  />
                ))}
                {feed.length === 0 && <p className={styles.noActivityNote}>{t('noActivity')}</p>}
              </>
            )}

            {/* "Suggested classrooms" — no GET /classrooms/suggested
                endpoint exists (documented future work per an earlier
                task's own fallback instruction), so this section stays
                unrendered rather than showing fabricated data, even
                though classrooms.length < 3 would otherwise trigger it. */}

            {!loading &&
              feed.length > 0 &&
              feed.map((item, index) => {
                const { icon, accent } = feedAccent(item.type);
                const group = dateGroupOf(item.created_at);
                const showGroupHeading = index === 0 || dateGroupOf(feed[index - 1]!.created_at) !== group;
                return (
                  <div key={item.id}>
                    {showGroupHeading && <p className="section-heading">{t(`dateGroup.${group}`)}</p>}
                    <button
                      type="button"
                      className={`card card-sm ${styles.feedItem} ${accent === 'success' ? styles.feedItemSuccess : ''}`}
                      onClick={() => handleFeedItemTap(item)}
                    >
                      <span className={styles.feedIcon} aria-hidden="true">
                        {icon}
                      </span>
                      <span className={styles.feedText}>
                        <span className={styles.feedTitle}>{item.title}</span>
                        {item.body && <span className={styles.feedBody}>{item.body}</span>}
                      </span>
                      <span className={styles.feedTime}>{safeRelativeTime(item.created_at)}</span>
                    </button>
                  </div>
                );
              })}
          </>
        )}
      </PageContainer>
    </AppShell>
  );
}
