'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { formatNumber, safeRelativeTime } from '@/lib/format';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import styles from './OverviewTab.module.css';
import tabStyles from './Tab.module.css';

const ACCEPTED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024;

interface OverviewTabProps {
  institutionId: string;
  onNavigateTab?: (tab: 'verify' | 'codes') => void;
}

// event_type values are dotted (e.g. "classroom.joined") — colliding with
// next-intl's own dot-based nested-key lookup, so this stays a plain JS
// transform rather than going through i18n for something this mechanical.
function humanizeEventType(eventType: string): string {
  return eventType
    .split('.')
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}

export function OverviewTab({ institutionId, onNavigateTab }: OverviewTabProps) {
  const router = useRouter();
  const t = useTranslations('adminDashboard.overview');
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<api.AdminOverview | null>(null);
  const [yearGroups, setYearGroups] = useState<api.AdminClassroomYearGroup[]>([]);
  const [memberGrowth, setMemberGrowth] = useState<api.AdminAnalytics['memberGrowth']>([]);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewData, classroomData, analyticsData] = await Promise.all([
        api.getOverview(institutionId),
        api.getClassrooms(institutionId),
        // TASKS_11 TASK 11 — memberGrowth is already computed by
        // getAnalytics() for StatsTab; reused here for this tab's line
        // chart rather than duplicating that aggregation in a second
        // endpoint.
        api.getAnalytics(institutionId),
      ]);
      setOverview(overviewData);
      setYearGroups(classroomData);
      setMemberGrowth(analyticsData.memberGrowth);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen || !overview) return;

    if (!ACCEPTED_LOGO_TYPES.includes(chosen.type)) {
      showToast(t('logo.errors.wrongType'), 'error');
      return;
    }
    if (chosen.size > MAX_LOGO_SIZE_BYTES) {
      showToast(t('logo.errors.tooLarge'), 'error');
      return;
    }

    setLogoUploading(true);
    try {
      const result = await api.uploadInstitutionLogo(institutionId, chosen);
      setOverview({ ...overview, logoUrl: result.logoUrl });
      showToast(t('logo.updatedToast'), 'success');
    } catch (err) {
      const statusCode = err instanceof ApiError ? err.statusCode : null;
      if (statusCode === 413) {
        showToast(t('logo.errors.tooLarge'), 'error');
      } else if (statusCode === 415) {
        showToast(t('logo.errors.wrongType'), 'error');
      } else if (statusCode === 403) {
        showToast(t('logo.errors.permissionDenied'), 'error');
      } else {
        showToast(t('logo.errors.uploadFailedGeneric'), 'error');
      }
    } finally {
      setLogoUploading(false);
    }
  };

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
      <div className={styles.logoSection}>
        {overview.logoUrl ? (
          <img src={overview.logoUrl} alt="" className={styles.logoImage} />
        ) : (
          <div className={styles.logoPlaceholder} aria-hidden="true">
            🏫
          </div>
        )}
        <Button
          variant="secondary"
          size="sm"
          loading={logoUploading}
          onClick={() => logoInputRef.current?.click()}
        >
          {logoUploading ? undefined : overview.logoUrl ? t('logo.changeButton') : t('logo.uploadButton')}
        </Button>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className={styles.hiddenInput}
          onChange={handleLogoFileChange}
        />
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.totalClassrooms)}</p>
          <p className={styles.statLabel}>{t('classrooms')}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.totalMembers)}</p>
          <p className={styles.statLabel}>{t('totalMembers')}</p>
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
          <p className={styles.statValue}>{formatNumber(overview.activeClassrooms)}</p>
          <p className={styles.statLabel}>{t('activeClassrooms')}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.newMembersThisMonth)}</p>
          <p className={styles.statLabel}>{t('newMembersThisMonth')}</p>
        </div>
      </div>

      {onNavigateTab && (
        <div className={styles.quickActions}>
          <Button variant="secondary" size="md" fullWidth onClick={() => onNavigateTab('verify')}>
            {t('quickActions.reviewVerifications')}
          </Button>
          <Button variant="secondary" size="md" fullWidth onClick={() => onNavigateTab('codes')}>
            {t('quickActions.generateCodes')}
          </Button>
        </div>
      )}

      {/* TASKS_11 TASK 11 — top 10 most active classrooms by message count in the last 30 days. */}
      <p className={tabStyles.sectionLabel}>{t('mostActiveClassrooms')}</p>
      {overview.topActiveClassrooms.length === 0 ? (
        <p className={styles.emptyHint}>{t('noActivity')}</p>
      ) : (
        <div className={styles.table}>
          <div className={styles.activeClassroomsHeaderRow}>
            <span>{t('classroomCol')}</span>
            <span>{t('membersCol')}</span>
            <span>{t('messages30dCol')}</span>
          </div>
          {overview.topActiveClassrooms.map((c) => (
            <button
              key={c.globalId}
              type="button"
              className={styles.activeClassroomRow}
              onClick={() => router.push(`/classroom/${c.globalId}`)}
            >
              <span className={styles.className}>{c.name}</span>
              <span>{formatNumber(c.memberCount)}</span>
              <span>{formatNumber(c.messageCount30d)}</span>
            </button>
          ))}
        </div>
      )}

      {/* TASKS_11 TASK 11 — hand-rolled SVG line chart, not recharts/a charting lib — none is installed in this project yet (see this file's own ICON_PROPS-style precedent elsewhere in the codebase for preferring a small inline implementation over a new dependency for one chart). */}
      <p className={tabStyles.sectionLabel}>{t('memberGrowth')}</p>
      {memberGrowth.length === 0 ? (
        <p className={styles.emptyHint}>{t('noData')}</p>
      ) : (
        <MemberGrowthChart data={memberGrowth} />
      )}

      {/* TASKS_11 TASK 11 — verification approval stats, link back to the Verify tab. */}
      <p className={tabStyles.sectionLabel}>{t('verificationStatsLabel')}</p>
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.verificationStats.approvedThisMonth)}</p>
          <p className={styles.statLabel}>{t('approvedThisMonth')}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{formatNumber(overview.verificationStats.pending)}</p>
          <p className={styles.statLabel}>{t('pendingVerifications')}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{overview.verificationStats.approvalRatePercent}%</p>
          <p className={styles.statLabel}>{t('approvalRate')}</p>
        </div>
      </div>
      {onNavigateTab && (
        <button type="button" className={styles.addClassLink} onClick={() => onNavigateTab('verify')}>
          {t('quickActions.reviewVerifications')}
        </button>
      )}

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

      {overview.recentActivity.length > 0 && (
        <>
          <p className={tabStyles.sectionLabel}>{t('recentActivity')}</p>
          {overview.recentActivity.map((entry) => (
            <div key={entry.id} className={styles.activityRow}>
              <span className={styles.activityText}>{humanizeEventType(entry.eventType)}</span>
              <span className={styles.activityTime}>{safeRelativeTime(entry.createdAt)}</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/** TASKS_11 TASK 11 — minimal inline SVG polyline chart, X axis = month, Y axis = cumulative member count. */
function MemberGrowthChart({ data }: { data: api.AdminAnalytics['memberGrowth'] }) {
  const width = 300;
  const height = 100;
  const padding = 10;
  const maxValue = Math.max(...data.map((d) => d.cumulative), 1);

  const points = data.map((d, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - (d.cumulative / maxValue) * (height - padding * 2);
    return `${x},${y}`;
  });

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} preserveAspectRatio="none">
        <polyline points={points.join(' ')} fill="none" stroke="var(--color-primary)" strokeWidth={2} />
      </svg>
      <div className={styles.chartLabels}>
        {data.map((d) => (
          <span key={d.month} className={styles.chartLabel}>
            {d.month.slice(5)}
          </span>
        ))}
      </div>
    </div>
  );
}
