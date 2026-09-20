'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { appConfig } from '@/lib/brand';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterChips } from '@/components/ui/FilterChips';
import styles from './ClassroomsTab.module.css';

interface ClassroomsTabProps {
  institutionId: string;
}

interface FlatClassroom extends api.AdminClassroomEntry {
  isActive: boolean;
}

type Filter = 'active' | 'alumni';

/**
 * TASK 11 TAB 3. Reuses GET /admin/:institutionId/classrooms — the same
 * endpoint OverviewTab/CodesTab already call — grouped by batch year; a
 * classroom's "Active" vs "Alumni" status is derived from its group's year
 * against the identical threshold ClassroomService.getMyClassrooms() uses
 * for isActive, not a second, possibly-drifting definition invented here.
 * No "last active time" per classroom — nothing in the schema tracks that
 * (would need a per-classroom last-message timestamp this endpoint has
 * never returned), so it's left out rather than faked.
 */
export function ClassroomsTab({ institutionId }: ClassroomsTabProps) {
  const t = useTranslations('adminDashboard.classrooms');
  const tOverview = useTranslations('adminDashboard.overview');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<FlatClassroom[]>([]);
  const [filter, setFilter] = useState<Filter | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const yearGroups = await api.getClassrooms(institutionId);
      const activeYearThreshold = new Date().getFullYear() - appConfig.CLASSROOM_ACTIVE_YEAR_WINDOW;
      const flat = yearGroups.flatMap((group) =>
        group.classrooms.map((c) => ({ ...c, isActive: group.year >= activeYearThreshold })),
      );
      setClassrooms(flat);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'active') return classrooms.filter((c) => c.isActive);
    if (filter === 'alumni') return classrooms.filter((c) => !c.isActive);
    return classrooms;
  }, [classrooms, filter]);

  if (loading) {
    return (
      <>
        <SkeletonCard />
        <SkeletonCard />
      </>
    );
  }

  if (error) return <ErrorMessage message={error} onRetry={load} fullPage />;

  if (classrooms.length === 0) {
    return <EmptyState icon="🏫" title={t('empty.title')} description={t('empty.description')} />;
  }

  return (
    <>
      <FilterChips
        options={[
          { value: 'active', label: t('filter.active') },
          { value: 'alumni', label: t('filter.alumni') },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as Filter | null)}
        allLabel={t('filter.all')}
      />

      <div className={styles.list}>
        {filtered.map((c) => (
          <div key={c.id} className="card">
            <div className={styles.row}>
              <p className={styles.name}>{c.name}</p>
              <span className={styles.globalId}>{c.globalId}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.meta}>
                {tOverview('memberSummary', { verified: c.verifiedCount, pending: c.pendingCount, total: c.memberCount })}
              </span>
            </div>
            <Link href={`/classroom/${c.globalId}`} className={styles.viewLink}>
              {t('viewClassroom')}
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
