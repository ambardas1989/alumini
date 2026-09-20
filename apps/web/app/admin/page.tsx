'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Persona } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { brand } from '@/lib/brand';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { OverviewTab } from './OverviewTab';
import { VerifyTab } from './VerifyTab';
import { ClassroomsTab } from './ClassroomsTab';
import { CodesTab } from './CodesTab';
import { StatsTab } from './StatsTab';
import { AdminsTab } from './AdminsTab';
import { InstitutionRequestsTab } from './InstitutionRequestsTab';
import styles from './page.module.css';

type Tab = 'overview' | 'verify' | 'classrooms' | 'codes' | 'stats' | 'admins' | 'requests';
const TAB_KEY = 'alumtribe_admin_tab';
const SCHOOL_ADMIN_TABS: Tab[] = ['overview', 'verify', 'classrooms', 'codes', 'stats', 'admins'];

export default function AdminDashboardPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const t = useTranslations('adminDashboard');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminPersonas, setAdminPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [pendingVerificationCount, setPendingVerificationCount] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');

  const adminPersona = adminPersonas.find((p) => p.id === selectedPersonaId) ?? adminPersonas[0] ?? null;

  const tabs = [...SCHOOL_ADMIN_TABS, ...(isPlatformAdmin ? (['requests'] as const) : [])];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(TAB_KEY) as Tab | null;
    if (stored && tabs.includes(stored)) setTab(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [personas, profile] = await Promise.all([api.getPersonas(), api.getProfile()]);
      // TASKS_03.md TASK 11 — "If admin of multiple institutions: show
      // institution selector dropdown at top." A user can hold more than
      // one active school_admin persona (one per institution — see
      // 001_initial_schema.sql's UNIQUE(user_id, type, institution_id)),
      // so this collects all of them rather than just the first.
      const schoolAdminPersonas = personas.filter((p) => p.type === 'school_admin');
      setAdminPersonas(schoolAdminPersonas);
      setIsPlatformAdmin(profile.isPlatformAdmin);
      if (profile.isPlatformAdmin) {
        // Best-effort — a platform admin without a school_admin persona
        // still needs to see this without the school-admin gate below.
        api
          .adminListInstitutionRequests('pending')
          .then((rows) => setPendingRequestCount(rows.length))
          .catch(() => undefined);
      }
      const active = schoolAdminPersonas.find((p) => p.status === 'active');
      if (active?.institutionId) {
        api
          .getPendingVerifications(active.institutionId)
          .then((rows) => setPendingVerificationCount(rows.length))
          .catch(() => undefined);
      }
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

  const changeTab = (next: Tab) => {
    setTab(next);
    if (typeof window !== 'undefined') window.sessionStorage.setItem(TAB_KEY, next);
  };

  if (!ready) return null;

  if (loading) {
    return (
      <AppShell showNav={false}>
        <PageContainer>
          <LoadingSpinner size="lg" fullPage />
        </PageContainer>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell showNav={false}>
        <PageContainer>
          <ErrorMessage message={error} onRetry={load} fullPage />
        </PageContainer>
      </AppShell>
    );
  }

  // A platform admin with no school_admin persona still gets in — just with
  // only the Requests tab (the school-admin-scoped tabs all need an
  // institutionId, which only a school_admin persona provides).
  if (!adminPersona && !isPlatformAdmin) {
    return (
      <AppShell showNav={false}>
        <PageContainer>
          <EmptyState
            icon="🏫"
            title={t('noPersona.title')}
            description={t('noPersona.description')}
            ctaLabel={t('noPersona.cta')}
            onCta={() => router.push('/onboarding')}
          />
        </PageContainer>
      </AppShell>
    );
  }

  if (!adminPersona && isPlatformAdmin) {
    return (
      <AppShell showNav={false}>
        <div className={styles.topBar}>
          <h1 className={styles.topBarTitle}>{t('title')}</h1>
        </div>
        <PageContainer>
          <InstitutionRequestsTab />
        </PageContainer>
      </AppShell>
    );
  }

  if (adminPersona!.status !== 'active') {
    return (
      <AppShell showNav={false}>
        <PageContainer noPadding>
          <div className={styles.pendingScreen}>
            <span className={styles.pendingIcon} aria-hidden="true">
              ⏳
            </span>
            <h1 className={styles.pendingTitle}>{t('pending.title')}</h1>
            <p className={styles.pendingBrandLine}>{brand.onboardingLines.school_admin}</p>
            <p className={styles.pendingDescription}>{t('pending.description')}</p>
            <Button variant="primary" size="lg" onClick={() => router.push('/')}>
              {t('pending.goHome')}
            </Button>
          </div>
        </PageContainer>
      </AppShell>
    );
  }

  const institutionId = adminPersona!.institutionId;
  if (!institutionId) return null;

  return (
    <AppShell showNav={false}>
      <div className={styles.topBar}>
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
      </div>

      {adminPersonas.length > 1 && (
        <div className={styles.institutionSelectorWrap}>
          <Select
            label={t('overview.institutionSelectorLabel')}
            value={adminPersona!.id}
            onChange={(e) => setSelectedPersonaId(e.target.value)}
          >
            {adminPersonas.map((p) => (
              // Persona carries no institution name — @alumini/types has no
              // "get institution by id" lookup this page can reach for
              // (same gap persona/page.tsx's subLabel fallback documents) —
              // the id is honest and still lets an admin tell entries apart.
              <option key={p.id} value={p.id}>
                {p.institutionId}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className={styles.tabBar} role="tablist">
        {tabs.map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            className={`${styles.tab} ${tab === tabKey ? styles.tabActive : ''}`}
            onClick={() => changeTab(tabKey)}
          >
            {tabKey === 'requests'
              ? t('tabs.requests', { count: pendingRequestCount })
              : tabKey === 'verify'
                ? t('tabs.verify', { count: pendingVerificationCount })
                : t(`tabs.${tabKey}`)}
          </button>
        ))}
      </div>

      <PageContainer>
        {tab === 'overview' && <OverviewTab institutionId={institutionId} onNavigateTab={changeTab} />}
        {tab === 'verify' && <VerifyTab institutionId={institutionId} />}
        {tab === 'classrooms' && <ClassroomsTab institutionId={institutionId} />}
        {tab === 'requests' && <InstitutionRequestsTab />}
        {tab === 'codes' && <CodesTab institutionId={institutionId} />}
        {tab === 'stats' && <StatsTab institutionId={institutionId} />}
        {tab === 'admins' && <AdminsTab institutionId={institutionId} />}
      </PageContainer>
    </AppShell>
  );
}
