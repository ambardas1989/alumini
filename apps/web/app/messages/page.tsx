'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { ConversationList } from './ConversationList';
import { ThreadView } from './ThreadView';
import { NewConversationOverlay } from './NewConversationOverlay';
import styles from './page.module.css';

export default function MessagesPage() {
  const { ready } = useRequireAuth();
  const t = useTranslations('messages');
  const searchParams = useSearchParams();
  const userId = searchParams.get('userId');
  // TASKS_09 TASK 23 — "Wish them" from a home-feed birthday card.
  const prefill = searchParams.get('prefill');
  // TASKS_09 TASK 04 — "New conversation" compose button + overlay.
  const [showCompose, setShowCompose] = useState(false);

  if (!ready) return null;

  if (userId) {
    return (
      <AppShell showNav={false}>
        <ThreadView userId={userId} initialValue={prefill ?? undefined} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.topBar}>
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
        <button
          type="button"
          className={styles.composeButton}
          aria-label={t('newConversation.title')}
          onClick={() => setShowCompose(true)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
          </svg>
        </button>
      </div>
      <PageContainer>
        <ConversationList />
      </PageContainer>

      {showCompose && <NewConversationOverlay onClose={() => setShowCompose(false)} />}
    </AppShell>
  );
}
