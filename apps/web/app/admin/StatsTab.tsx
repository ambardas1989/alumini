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

/** TASK 11 TAB 5 — three simple tables: member growth, verification methods, top classrooms. */
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

      <p className={tabStyles.sectionLabel}>{t('memberGrowth')}</p>
      {analytics.memberGrowth.length === 0 ? (
        <p className={styles.emptyHint}>{t('noData')}</p>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeaderRow}>
            <span>{t('month')}</span>
            <span>{t('newMembersCol')}</span>
            <span>{t('cumulative')}</span>
          </div>
          {analytics.memberGrowth.map((row) => (
            <div key={row.month} className={styles.tableRow}>
              <span>{row.month}</span>
              <span>{formatNumber(row.newMembers)}</span>
              <span>{formatNumber(row.cumulative)}</span>
            </div>
          ))}
        </div>
      )}

      <p className={tabStyles.sectionLabel}>{t('methodBreakdown')}</p>
      {methodEntries.length === 0 ? (
        <p className={styles.emptyHint}>{t('noMethods')}</p>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeaderRow}>
            <span>{t('method')}</span>
            <span>{t('count')}</span>
            <span>{t('percentOfTotal')}</span>
          </div>
          {methodEntries.map(([method, count]) => (
            <div key={method} className={styles.tableRow}>
              <span>{t(`methods.${method}`)}</span>
              <span>{formatNumber(count)}</span>
              <span>{Math.round((count / methodTotal) * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      <p className={tabStyles.sectionLabel}>{t('topClassrooms')}</p>
      {topClassrooms.length === 0 ? (
        <p className={styles.emptyHint}>{t('noClassrooms')}</p>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeaderRowTwo}>
            <span>{t('classroom')}</span>
            <span>{t('members')}</span>
          </div>
          {topClassrooms.map((c) => (
            <div key={c.classroomId} className={styles.tableRowTwo}>
              <span className={styles.tableClassroomName}>{c.name}</span>
              <span>{formatNumber(c.memberCount)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
