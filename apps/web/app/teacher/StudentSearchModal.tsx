'use client';

import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useDebounce } from '@/lib/useDebounce';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SheetModal } from '@/components/ui/SheetModal';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './StudentSearchModal.module.css';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

const STATUS_BADGE: Record<string, BadgeVariant> = {
  verified: 'verified',
  pending: 'pending',
  rejected: 'rejected',
};

interface StudentSearchModalProps {
  onClose: () => void;
}

export function StudentSearchModal({ onClose }: StudentSearchModalProps) {
  const t = useTranslations('teacherHome.search');
  const tStatus = useTranslations('status');
  const { showToast } = useToast();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const [results, setResults] = useState<api.StudentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (debouncedQuery.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .searchStudents(debouncedQuery.trim())
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  if (selectedUserId) {
    return (
      <StudentDetail
        userId={selectedUserId}
        onBack={() => setSelectedUserId(null)}
        onClose={onClose}
        onError={(msg) => showToast(msg, 'error')}
      />
    );
  }

  return (
    <SheetModal title={t('title')} onClose={onClose}>
      <div className={styles.searchField}>
        <Input
          label={t('inputLabel')}
          placeholder={t('placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {loading && (
        <div className={styles.centered}>
          <LoadingSpinner size="md" />
        </div>
      )}

      {!loading && error && <ErrorMessage message={error} />}

      {!loading && !error && query.trim().length < MIN_QUERY_LENGTH && (
        <p className={styles.hint}>{t('minChars')}</p>
      )}

      {!loading && !error && query.trim().length >= MIN_QUERY_LENGTH && results.length === 0 && (
        <EmptyState icon="🔍" title={t('noResults.title')} description={t('noResults.description')} />
      )}

      {!loading && !error && results.length > 0 && (
        <div className={styles.list}>
          {results.map((r) => (
            <button
              key={`${r.userId}-${r.classroomId}`}
              type="button"
              className={styles.row}
              onClick={() => setSelectedUserId(r.userId)}
            >
              <Avatar avatarUrl={r.avatarUrl} fullName={r.fullName} size="md" />
              <span className={styles.rowText}>
                <span className={styles.rowName}>{r.fullName}</span>
                <span className={styles.rowMeta}>
                  {r.classroomName ?? t('unknownClass')}
                  {r.batchYear ? ` · ${r.batchYear}` : ''}
                </span>
              </span>
              {STATUS_BADGE[r.verificationStatus] && (
                <Badge variant={STATUS_BADGE[r.verificationStatus]!} label={tStatus(r.verificationStatus)} />
              )}
            </button>
          ))}
        </div>
      )}
    </SheetModal>
  );
}

interface StudentDetailProps {
  userId: string;
  onBack: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}

function StudentDetail({ userId, onBack, onClose, onError }: StudentDetailProps) {
  const t = useTranslations('teacherHome.search');
  const [profile, setProfile] = useState<api.StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getStudentProfile(userId)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleRecommend = async () => {
    if (!profile) return;
    const primaryClass = profile.sharedClassrooms[0];
    const letter = t('recommendation.template', {
      name: profile.fullName,
      className: primaryClass?.classroomName ?? t('unknownClass'),
      year: primaryClass?.batchYear ?? '',
    });
    try {
      await navigator.clipboard.writeText(letter);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError(t('recommendation.copyFailed'));
    }
  };

  return (
    <SheetModal title={t('detailTitle')} onClose={onClose}>
      <button type="button" className={styles.backLink} onClick={onBack}>
        ← {t('backToResults')}
      </button>

      {loading && (
        <div className={styles.centered}>
          <LoadingSpinner size="md" />
        </div>
      )}

      {!loading && error && <ErrorMessage message={error} />}

      {!loading && !error && profile && (
        <>
          <div className={styles.profileHeader}>
            <Avatar avatarUrl={profile.avatarUrl} fullName={profile.fullName} size="lg" />
            <p className={styles.profileName}>{profile.fullName}</p>
            {profile.linkedinUrl && (
              <a href={profile.linkedinUrl} target="_blank" rel="noreferrer" className={styles.linkedinLink}>
                {t('viewLinkedIn')}
              </a>
            )}
          </div>

          <p className={styles.sectionLabel}>{t('sharedClassrooms')}</p>
          <div className={styles.list}>
            {profile.sharedClassrooms.map((c) => (
              <div key={c.classroomId} className={styles.sharedRow}>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{c.classroomName ?? t('unknownClass')}</span>
                  <span className={styles.rowMeta}>
                    {c.role} · {c.batchYear ?? '—'}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <Button variant="secondary" size="md" fullWidth onClick={handleRecommend}>
            {copied ? t('recommendation.copied') : t('recommendation.cta')}
          </Button>
        </>
      )}
    </SheetModal>
  );
}
