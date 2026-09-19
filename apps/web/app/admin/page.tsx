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
import { OverviewTab } from './OverviewTab';
import { VerifyTab } from './VerifyTab';
import { CodesTab } from './CodesTab';
import { StatsTab } from './StatsTab';
import { AdminsTab } from './AdminsTab';
import styles from './page.module.css';

type Tab = 'overview' | 'verify' | 'codes' | 'stats' | 'admins';
const TAB_KEY = 'alumtribe_admin_tab';
const TABS: Tab[] = ['overview', 'verify', 'codes', 'stats', 'admins'];

export default function AdminDashboardPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const t = useTranslations('adminDashboard');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminPersona, setAdminPersona] = useState<Persona | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(TAB_KEY) as Tab | null;
    if (stored && TABS.includes(stored)) setTab(stored);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const personas = await api.getPersonas();
      setAdminPersona(personas.find((p) => p.type === 'school_admin') ?? null);
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

  if (!adminPersona) {
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

  if (adminPersona.status !== 'active') {
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

  const institutionId = adminPersona.institutionId;
  if (!institutionId) return null;

  return (
    <AppShell showNav={false}>
      <div className={styles.topBar}>
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
      </div>

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
        {tab === 'overview' && <OverviewTab institutionId={institutionId} />}
        {tab === 'verify' && <VerifyTab institutionId={institutionId} />}
        {tab === 'codes' && <CodesTab institutionId={institutionId} />}
        {tab === 'stats' && <StatsTab institutionId={institutionId} />}
        {tab === 'admins' && <AdminsTab institutionId={institutionId} />}
      </PageContainer>
    </AppShell>
  );
}
