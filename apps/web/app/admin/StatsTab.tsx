'use client';

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { formatNumber } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './StatsTab.module.css';
import tabStyles from './Tab.module.css';

interface StatsTabProps {
  institutionId: string;
}

const METHOD_COLOR_VARS: Record<string, string> = {
  email: 'var(--color-info)',
  document: 'var(--color-primary)',
  linkedin: 'var(--color-linkedin)',
  peer_vouch: 'var(--color-success)',
  personal_code: 'var(--color-warning)',
  batch_code: 'var(--color-warning)',
};
const FALLBACK_METHOD_COLOR = 'var(--color-text-muted)';

export function StatsTab({ institutionId }: StatsTabProps) {
  const t = useTranslations('adminDashboard.stats');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<api.AdminAnalytics | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAnalytics(await api.getAnalytics(institutionId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <>
        <SkeletonCard />
        <SkeletonCard />
      </>
    );
  }

  if (error) return <ErrorMessage message={error} onRetry={load} fullPage />;
  if (!analytics) return null;

  const topClassrooms = [...analytics.topClassrooms].sort((a, b) => b.memberCount - a.memberCount).slice(0, 5);
  const maxMemberCount = Math.max(1, ...topClassrooms.map((c) => c.memberCount));
  const methodEntries = Object.entries(analytics.verificationMethodBreakdown).filter(([, count]) => count > 0);
  const methodTotal = methodEntries.reduce((sum, [, count]) => sum + count, 0) || 1;

  return (
    <>
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(analytics.activeAlumniCount)}</p>
          <p className={styles.statLabel}>{t('activeAlumni')}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(analytics.newMembersThisMonth)}</p>
          <p className={styles.statLabel}>{t('newMembers')}</p>
        </div>
      </div>

      <p className={tabStyles.sectionLabel}>{t('topClassrooms')}</p>
      {topClassrooms.length === 0 ? (
        <p className={styles.emptyHint}>{t('noClassrooms')}</p>
      ) : (
        <div className={styles.barChart}>
          {topClassrooms.map((c) => (
            <div key={c.classroomId} className={styles.barRow}>
              <span className={styles.barLabel}>{c.name}</span>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${(c.memberCount / maxMemberCount) * 100}%` }} />
              </div>
              <span className={styles.barValue}>{formatNumber(c.memberCount)}</span>
            </div>
          ))}
        </div>
      )}

      <p className={tabStyles.sectionLabel}>{t('methodBreakdown')}</p>
      {methodEntries.length === 0 ? (
        <p className={styles.emptyHint}>{t('noMethods')}</p>
      ) : (
        <div className={styles.pillRow}>
          {methodEntries.map(([method, count]) => (
            <span
              key={method}
              className={styles.pill}
              style={{ ['--pill-color' as string]: METHOD_COLOR_VARS[method] ?? FALLBACK_METHOD_COLOR }}
            >
              {t(`methods.${method}`)} · {Math.round((count / methodTotal) * 100)}%
            </span>
          ))}
        </div>
      )}
    </>
  );
}
