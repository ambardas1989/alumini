'use client';

import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './page.module.css';

/**
 * Placeholder — direct messages are not built yet. This tab exists purely
 * to anchor the bottom nav visually (TASK 08's explicit instruction: "Do
 * NOT remove this tab").
 */
export default function MessagesPage() {
  const { ready } = useRequireAuth();
  const t = useTranslations('messages');

  if (!ready) return null;

  return (
    <AppShell>
      <div className={styles.topBar}>
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
      </div>
      <PageContainer>
        <EmptyState icon="💬" title={t('comingSoonTitle')} description={t('comingSoonDescription')} />
      </PageContainer>
    </AppShell>
  );
}
