'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import type { DmConversation } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeRelativeTime } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './ConversationList.module.css';

export function ConversationList() {
  const router = useRouter();
  const t = useTranslations('messages');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setConversations(await api.getDmConversations());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => (c.user.fullName ?? '').toLowerCase().includes(q));
  }, [conversations, query]);

  return (
    <>
      <div className={styles.searchWrap}>
        <Input
          label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <ErrorMessage message={error} onRetry={load} />}

      {!error && loading && (
        <div className={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!error && !loading && filtered.length === 0 && (
        <EmptyState icon="💬" title={t('emptyTitle')} description={t('emptyDescription')} />
      )}

      {!error && !loading && filtered.length > 0 && (
        <ul className={styles.list}>
          {filtered.map((c) => (
            <li key={c.user.id}>
              <button
                type="button"
                className={styles.card}
                onClick={() => router.push(`/messages?userId=${c.user.id}`)}
              >
                <Avatar avatarUrl={c.user.avatarUrl} fullName={c.user.fullName ?? '?'} size="lg" />
                <div className={styles.info}>
                  <p className={styles.name}>{c.user.fullName}</p>
                  <p className={styles.preview}>
                    {c.lastMessage.content ?? ''}
                  </p>
                </div>
                <div className={styles.meta}>
                  <span className={styles.time}>{safeRelativeTime(c.lastMessage.createdAt)}</span>
                  {c.unreadCount > 0 && <span className={styles.badge}>{c.unreadCount}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
