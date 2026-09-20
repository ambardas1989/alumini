'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Classroom, Institution, VerificationStatus } from '@alumini/types';
import * as api from '@/lib/api';
import type { NotificationRow } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { UserMenu } from '@/components/UserMenu';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
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

function greetingKey(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setNudgeDismissed(!!window.sessionStorage.getItem(NUDGE_DISMISSED_KEY));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [myClassrooms, notifications, unread] = await Promise.all([
        api.getMyClassrooms(),
        api.getNotifications(20),
        api.getUnreadNotificationCount(),
      ]);
      setClassrooms(flatten(myClassrooms));
      setFeed(notifications);
      setUnreadCount(unread.count);
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
  const firstName = user?.fullName?.split(' ')[0] ?? '';

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
        <UserMenu />
        <div className={styles.topBarText}>
          <h1 className={styles.greeting}>{t(`greeting.${greetingKey()}`, { name: firstName })}</h1>
          <p className={styles.subtitle}>
            {t('subtitle', { classrooms: classrooms.length, unread: unreadCount })}
          </p>
        </div>
        {/* Placeholder — the real dropdown is TASK 09's job; this still just
            links visually via the badge count, no click handler yet. */}
        <span className={styles.bellIcon} title={t('notificationsComingSoon')}>
          <BellIcon />
          {unreadCount > 0 && <span className={styles.bellBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </span>
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

            {!loading && feed.length === 0 && (
              <EmptyState
                icon="🎓"
                title={t('empty.title')}
                description={t('empty.description')}
                ctaLabel={t('empty.cta')}
                onCta={() => router.push('/classes')}
              />
            )}

            {!loading &&
              feed.map((item) => {
                const { icon, accent } = feedAccent(item.type);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.feedItem} ${accent === 'success' ? styles.feedItemSuccess : ''}`}
                    onClick={() => handleFeedItemTap(item)}
                  >
                    <span className={styles.feedIcon} aria-hidden="true">
                      {icon}
                    </span>
                    <span className={styles.feedText}>
                      <span className={styles.feedTitle}>{item.title}</span>
                      {item.body && <span className={styles.feedBody}>{item.body}</span>}
                    </span>
                    <span className={styles.feedTime}>{formatRelativeTime(item.created_at)}</span>
                  </button>
                );
              })}

            {/* "Suggested classrooms" — no GET /classrooms/suggested endpoint
                exists (documented future work per TASK 08's own fallback
                instruction), so this section stays unrendered rather than
                showing fabricated data. */}
          </>
        )}
      </PageContainer>
    </AppShell>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
