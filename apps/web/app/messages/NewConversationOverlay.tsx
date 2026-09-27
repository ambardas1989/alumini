'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import type { UserSearchResult } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useDebounce } from '@/lib/useDebounce';
import { useTranslations } from '@/lib/useTranslations';
import { SheetModal } from '@/components/ui/SheetModal';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './NewConversationOverlay.module.css';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

interface NewConversationOverlayProps {
  onClose: () => void;
}

/** TASKS_09 TASK 04/20 — "New message" search overlay: platform-wide, by name or exact email. */
export function NewConversationOverlay({ onClose }: NewConversationOverlayProps) {
  const router = useRouter();
  const t = useTranslations('messages.newConversation');

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setError(null);
    api
      .searchUsers(q)
      .then((data) => {
        if (!cancelled) {
          setResults(data);
          setSearched(true);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const handleSelect = (result: UserSearchResult) => {
    onClose();
    router.push(`/messages?userId=${result.id}`);
  };

  return (
    <SheetModal title={t('title')} onClose={onClose}>
      <div className={styles.wrap}>
        <Input
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {searching && (
          <div className={styles.status}>
            <LoadingSpinner size="sm" />
          </div>
        )}

        {error && !searching && <ErrorMessage message={error} />}

        {!searching && !error && searched && results.length === 0 && (
          <p className={styles.noResults}>{t('noResults', { query: debouncedQuery.trim() })}</p>
        )}

        {!searching && results.length > 0 && (
          <ul className={styles.results}>
            {results.map((result) => (
              <li key={result.id}>
                <button type="button" className={styles.resultRow} onClick={() => handleSelect(result)}>
                  <Avatar avatarUrl={result.avatarUrl} fullName={result.fullName ?? '?'} size="md" />
                  <div className={styles.resultInfo}>
                    <span className={styles.resultName}>{result.fullName}</span>
                    {result.sharedClassroom && (
                      <span className={styles.resultMeta}>{t('alsoIn', { classroom: result.sharedClassroom.name })}</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SheetModal>
  );
}
