'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Institution } from '@alumini/types';
import * as api from '@/lib/api';
import type { InstitutionAdminRequestRole } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useDebounce } from '@/lib/useDebounce';
import { useTranslations } from '@/lib/useTranslations';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const ROLES: InstitutionAdminRequestRole[] = ['principal', 'vice_principal', 'admin_staff', 'teacher'];

/**
 * TASKS_11 TASK 01 — "request institution admin access" form. A sibling
 * of apps/web/app/onboarding/claim/page.tsx's institution-search UI, not a
 * refactor of it: that page's claimInstitution() call 409s on an
 * already-claimed institution (SPEC.md §11.1's "co-admin needs a Primary
 * Admin invite instead" rule), but this flow's whole point is to also let
 * a platform admin add a co-admin directly when that's slow — see
 * InstitutionService.requestAdminAccess()'s own comment.
 */
export default function RequestInstitutionAdminAccessPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const t = useTranslations('institutionAdmin.request');

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const [results, setResults] = useState<Institution[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Institution | null>(null);

  const [role, setRole] = useState<InstitutionAdminRequestRole>('principal');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (selected || debouncedQuery.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    api
      .searchInstitutions(debouncedQuery.trim())
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selected]);

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.requestInstitutionAdminAccess({
        institutionId: selected.id,
        fullName: user?.fullName ?? '',
        role,
        message: message.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) return null;

  if (submitted) {
    return (
      <AppShell showNav={false}>
        <div className={styles.confirmWrap}>
          <span className={styles.checkCircle} aria-hidden="true">
            ✓
          </span>
          <h1 className={styles.confirmTitle}>{t('confirmTitle')}</h1>
          <p className={styles.confirmMessage}>{t('confirmMessage')}</p>
          <Button variant="primary" size="lg" fullWidth onClick={() => router.push('/')}>
            {t('goHomeButton')}
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell showNav={false}>
      <PageHeader title={t('title')} showBack />
      <PageContainer>
        <div className={styles.wrap}>
          {!selected && (
            <div className={styles.searchWrap}>
              <Input
                label={t('searchLabel')}
                placeholder={t('searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />

              {searching && (
                <div className={styles.searchStatus}>
                  <LoadingSpinner size="sm" />
                </div>
              )}
              {searchError && <ErrorMessage message={searchError} />}

              {!searching && results.length > 0 && (
                <ul className={styles.results}>
                  {results.map((institution) => (
                    <li key={institution.id}>
                      <button type="button" className={styles.resultRow} onClick={() => setSelected(institution)}>
                        <span className={styles.resultName}>{institution.name}</span>
                        <span className={styles.resultMeta}>
                          {institution.type}
                          {institution.cityCode ? ` · ${institution.cityCode}` : ''} · {institution.countryCode}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {selected && (
            <>
              <div className={styles.selectedCard}>
                <div>
                  <p className={styles.resultName}>{selected.name}</p>
                  <p className={styles.resultMeta}>
                    {selected.type}
                    {selected.cityCode ? ` · ${selected.cityCode}` : ''} · {selected.countryCode}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.changeLink}
                  onClick={() => {
                    setSelected(null);
                    setQuery('');
                  }}
                >
                  {t('changeLink')}
                </button>
              </div>

              <Select label={t('roleLabel')} value={role} onChange={(e) => setRole(e.target.value as InstitutionAdminRequestRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </Select>

              <Textarea
                label={t('messageLabel')}
                placeholder={t('messagePlaceholder')}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
              />

              {submitError && <ErrorMessage message={submitError} />}

              <Button variant="primary" size="lg" fullWidth loading={submitting} onClick={handleSubmit}>
                {t('submitButton')}
              </Button>
            </>
          )}
        </div>
      </PageContainer>
    </AppShell>
  );
}
