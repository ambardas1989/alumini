'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { formatNumber } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import styles from './OverviewTab.module.css';
import tabStyles from './Tab.module.css';

interface OverviewTabProps {
  institutionId: string;
}

export function OverviewTab({ institutionId }: OverviewTabProps) {
  const router = useRouter();
  const t = useTranslations('adminDashboard.overview');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<api.AdminOverview | null>(null);
  const [yearGroups, setYearGroups] = useState<api.AdminClassroomYearGroup[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewData, classroomData] = await Promise.all([
        api.getOverview(institutionId),
        api.getClassrooms(institutionId),
      ]);
      setOverview(overviewData);
      setYearGroups(classroomData);
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
  if (!overview) return null;

  return (
    <>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.totalClassrooms)}</p>
          <p className={styles.statLabel}>{t('classrooms')}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.totalVerifiedMembers)}</p>
          <p className={styles.statLabel}>{t('verifiedMembers')}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.pendingVerifications)}</p>
          <p className={styles.statLabel}>{t('pendingVerifications')}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.activeCodes)}</p>
          <p className={styles.statLabel}>{t('activeCodes')}</p>
        </div>
      </div>

      <div className={tabStyles.sectionHeader}>
        <p className={tabStyles.sectionLabel}>{t('classroomsByYear')}</p>
        {/*
         * /classroom/create has no institutionId query param to pre-fill —
         * it drives its own institution search/select flow — so this just
         * routes there and the admin re-selects this school.
         */}
        <button type="button" className={styles.addClassLink} onClick={() => router.push('/classroom/create')}>
          {t('addClass')}
        </button>
      </div>

      {yearGroups.length === 0 && (
        <EmptyState icon="🏫" title={t('empty.title')} description={t('empty.description')} />
      )}

      {yearGroups.map((group) => (
        <div key={group.year} className={styles.yearGroup}>
          <p className={styles.yearLabel}>{group.year}</p>
          {group.classrooms.map((c) => (
            <div key={c.id} className={styles.classRow}>
              <span className={styles.className}>{[c.name, c.grade, c.section, c.program].filter(Boolean).join(' · ')}</span>
              <span className={styles.classMeta}>
                {t('memberSummary', { verified: c.verifiedCount, pending: c.pendingCount, total: c.memberCount })}
              </span>
            </div>
          ))}
        </div>
      ))}

      <Button variant="secondary" size="md" fullWidth onClick={() => router.push('/classroom/create')}>
        {t('addClass')}
      </Button>
    </>
  );
}
