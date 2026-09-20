'use client';

import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { ConversationList } from './ConversationList';
import { ThreadView } from './ThreadView';
import styles from './page.module.css';

export default function MessagesPage() {
  const { ready } = useRequireAuth();
  const t = useTranslations('messages');
  const searchParams = useSearchParams();
  const userId = searchParams.get('userId');

  if (!ready) return null;

  if (userId) {
    return (
      <AppShell showNav={false}>
        <ThreadView userId={userId} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.topBar}>
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
      </div>
      <PageContainer>
        <ConversationList />
      </PageContainer>
    </AppShell>
  );
}
