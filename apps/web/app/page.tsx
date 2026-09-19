'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Classroom, Institution, VerificationStatus } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { UserMenu } from '@/components/UserMenu';
import { Button } from '@/components/ui/Button';
import { ClassroomCard, type ClassroomCardData } from '@/components/ClassroomCard';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { Fab } from '@/components/ui/Fab';
import styles from './page.module.css';

const WELCOME_KEY = 'alumtribe_welcomed';
const NUDGE_DISMISSED_KEY = 'alumtribe_verify_nudge_dismissed';

interface FlatClassroom extends Classroom {
  institution: Institution;
  verificationStatus: VerificationStatus;
}

// Verified first, then pending, then anything else (e.g. rejected) last.
const STATUS_ORDER: Record<string, number> = { verified: 0, pending: 1, rejected: 2 };

function flatten(
  groups: Array<{ institution: Institution; classes: Array<Classroom & { verificationStatus: string }> }>,
): FlatClassroom[] {
  return groups
    .flatMap((group) =>
      group.classes.map((c) => ({ ...c, institution: group.institution }) as FlatClassroom),
    )
    .sort((a, b) => (STATUS_ORDER[a.verificationStatus] ?? 9) - (STATUS_ORDER[b.verificationStatus] ?? 9));
}

export default function HomePage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const t = useTranslations('home');
  const tCommon = useTranslations('common');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<FlatClassroom[]>([]);
  const [showWelcome, setShowWelcome] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setShowWelcome(!window.localStorage.getItem(WELCOME_KEY));
    setNudgeDismissed(!!window.sessionStorage.getItem(NUDGE_DISMISSED_KEY));
  }, []);

  const loadClassrooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMyClassrooms();
      setClassrooms(flatten(data));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadClassrooms();
  }, [ready, loadClassrooms]);

  const dismissWelcome = () => {
    window.localStorage.setItem(WELCOME_KEY, '1');
    setShowWelcome(false);
  };

  const dismissNudge = () => {
    window.sessionStorage.setItem(NUDGE_DISMISSED_KEY, '1');
    setNudgeDismissed(true);
  };

  const firstPending = classrooms.find((c) => c.verificationStatus === 'pending');

  if (!ready) return null;

  return (
    <AppShell>
      <div className={styles.topBar}>
        <UserMenu />
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
        {/* Placeholder — no notifications screen exists yet, so this is
            decorative rather than a fake-functional button. */}
        <span className={styles.bellIcon} aria-hidden="true">
          <BellIcon />
        </span>
      </div>

      {showWelcome && (
        <div className={styles.welcomeBanner}>
          <p>{t('welcomeBanner')}</p>
          <button type="button" onClick={dismissWelcome} aria-label={tCommon('dismiss')} className={styles.dismissButton}>
            ×
          </button>
        </div>
      )}

      {firstPending && !nudgeDismissed && (
        // Two sibling buttons, not a button nested inside a button (invalid
        // HTML — interactive content can't contain further interactive
        // content, and it breaks keyboard/screen-reader navigation).
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
        {error && <ErrorMessage message={error} onRetry={loadClassrooms} />}

        {!error && (
          <>
            <p className={styles.sectionLabel}>{t('activeClassrooms')}</p>

            {loading && (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}

            {!loading && classrooms.length === 0 && (
              <EmptyState
                icon="🎓"
                title={t('empty.title')}
                description={t('empty.description')}
                ctaLabel={t('empty.cta')}
                onCta={() => router.push('/classroom/create')}
              />
            )}

            {!loading &&
              classrooms.map((classroom) => (
                <ClassroomCard
                  key={classroom.id}
                  classroom={
                    {
                      globalId: classroom.globalId,
                      name: classroom.name,
                      batchYear: classroom.batchYear,
                      memberCount: classroom.memberCount,
                      institution: { name: classroom.institution.name },
                      verificationStatus: classroom.verificationStatus,
                    } satisfies ClassroomCardData
                  }
                />
              ))}

            {/* "Suggested for you" — no backend endpoint returns suggestion
                data today (getMyClassrooms() has no such field); this stays
                unrendered until one does rather than showing fabricated data. */}
          </>
        )}
      </PageContainer>

      <Fab icon={<PlusIcon />} label={t('createClassroomFab')} onClick={() => router.push('/classroom/create')} />
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

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
