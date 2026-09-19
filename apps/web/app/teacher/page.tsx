'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { formatNumber } from '@/lib/format';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { Avatar } from '@/components/ui/Avatar';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { InstitutionAccordion } from './InstitutionAccordion';
import { ClassRow } from './ClassRow';
import { StudentSearchModal } from './StudentSearchModal';
import type { InstitutionGroup, TeacherClassroom } from './types';
import styles from './page.module.css';

type Tab = 'school' | 'year' | 'active' | 'archive';
const TAB_KEY = 'alumtribe_teacher_tab';
const TABS: Tab[] = ['school', 'year', 'active', 'archive'];

export default function TeacherHomePage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const t = useTranslations('teacherHome');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<InstitutionGroup[]>([]);
  const [tab, setTab] = useState<Tab>('school');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(TAB_KEY) as Tab | null;
    if (stored && TABS.includes(stored)) setTab(stored);
  }, []);

  const isTeacher = user?.activePersona === 'teacher';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMyClassrooms();
      const teacherGroups: InstitutionGroup[] = data
        .map((g) => ({
          institution: g.institution,
          classes: g.classes.filter((c): c is TeacherClassroom => c.userRole === 'teacher'),
        }))
        .filter((g) => g.classes.length > 0);
      setGroups(teacherGroups);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !isTeacher) return;
    load();
  }, [ready, isTeacher, load]);

  const allClasses = useMemo(() => groups.flatMap((g) => g.classes), [groups]);

  // memberCount includes the teacher (and any co-staff) alongside students,
  // and the same student appearing in two of this teacher's classes counts
  // twice here — there's no "distinct students taught" endpoint to derive
  // an exact figure from, so this is a documented approximation.
  const totalStudents = useMemo(
    () => allClasses.reduce((sum, c) => sum + Math.max(0, c.memberCount - 1), 0),
    [allClasses],
  );
  const yearsTeaching = useMemo(() => new Set(allClasses.map((c) => c.batchYear)).size, [allClasses]);
  const schoolsCount = groups.length;

  const activeClasses = useMemo(() => allClasses.filter((c) => c.isActive), [allClasses]);
  const archiveGroups = useMemo(
    () =>
      groups
        .map((g) => ({ institution: g.institution, classes: g.classes.filter((c) => !c.isActive) }))
        .filter((g) => g.classes.length > 0),
    [groups],
  );

  const years = useMemo(
    () => Array.from(new Set(allClasses.map((c) => c.batchYear))).sort((a, b) => b - a),
    [allClasses],
  );
  const effectiveYear = selectedYear ?? years[0] ?? null;
  const yearGroups = useMemo(() => {
    if (effectiveYear === null) return [];
    return groups
      .map((g) => ({ institution: g.institution, classes: g.classes.filter((c) => c.batchYear === effectiveYear) }))
      .filter((g) => g.classes.length > 0);
  }, [groups, effectiveYear]);

  const changeTab = (next: Tab) => {
    setTab(next);
    if (typeof window !== 'undefined') window.sessionStorage.setItem(TAB_KEY, next);
  };

  if (!ready) return null;

  if (!isTeacher) {
    return (
      <AppShell showNav={false}>
        <PageContainer>
          <EmptyState
            icon="✏️"
            title={t('noPersona.title')}
            description={t('noPersona.description')}
            ctaLabel={t('noPersona.cta')}
            onCta={() => router.push('/onboarding')}
          />
        </PageContainer>
      </AppShell>
    );
  }

  return (
    <AppShell showNav={false}>
      <div className={styles.topBar}>
        <Link href="/persona" aria-label={t('title')}>
          <Avatar avatarUrl={user?.avatarUrl} fullName={user?.fullName ?? ''} size="sm" />
        </Link>
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
        <button type="button" className={styles.searchButton} aria-label={t('search.title')} onClick={() => setSearchOpen(true)}>
          <SearchIcon />
        </button>
      </div>

      {!loading && !error && allClasses.length > 0 && (
        <div className={styles.statsStrip}>
          <div className={styles.statCard}>
            <p className={styles.statValue}>{formatNumber(totalStudents)}</p>
            <p className={styles.statLabel}>{t('stats.students')}</p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statValue}>{yearsTeaching}</p>
            <p className={styles.statLabel}>{t('stats.years')}</p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statValue}>{schoolsCount}</p>
            <p className={styles.statLabel}>{t('stats.schools')}</p>
          </div>
        </div>
      )}

      <div className={styles.tabBar} role="tablist">
        {TABS.map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            className={`${styles.tab} ${tab === tabKey ? styles.tabActive : ''}`}
            onClick={() => changeTab(tabKey)}
          >
            {t(`tabs.${tabKey}`)}
          </button>
        ))}
      </div>

      <PageContainer>
        {loading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {!loading && error && <ErrorMessage message={error} onRetry={load} fullPage />}

        {!loading && !error && allClasses.length === 0 && (
          <EmptyState icon="🏫" title={t('empty.title')} description={t('empty.description')} />
        )}

        {!loading && !error && allClasses.length > 0 && (
          <>
            {tab === 'school' &&
              groups.map((g) => <InstitutionAccordion key={g.institution.id} group={g} defaultOpen />)}

            {tab === 'year' && (
              <>
                <div className={styles.yearPills}>
                  {years.map((y) => (
                    <button
                      key={y}
                      type="button"
                      className={`${styles.yearPill} ${effectiveYear === y ? styles.yearPillActive : ''}`}
                      onClick={() => setSelectedYear(y)}
                    >
                      {y}
                    </button>
                  ))}
                </div>
                {yearGroups.map((g) => (
                  <div key={g.institution.id} className={styles.yearGroup}>
                    <p className={styles.yearGroupLabel}>{g.institution.name}</p>
                    {g.classes.map((c) => (
                      <ClassRow key={c.id} classroom={c} />
                    ))}
                  </div>
                ))}
              </>
            )}

            {tab === 'active' &&
              (activeClasses.length === 0 ? (
                <EmptyState icon="📋" title={t('activeEmpty.title')} description={t('activeEmpty.description')} />
              ) : (
                activeClasses.map((c) => <ClassRow key={c.id} classroom={c} />)
              ))}

            {tab === 'archive' &&
              (archiveGroups.length === 0 ? (
                <EmptyState icon="🗄️" title={t('archiveEmpty.title')} description={t('archiveEmpty.description')} />
              ) : (
                archiveGroups.map((g) => <InstitutionAccordion key={g.institution.id} group={g} />)
              ))}
          </>
        )}
      </PageContainer>

      {searchOpen && <StudentSearchModal onClose={() => setSearchOpen(false)} />}
    </AppShell>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
