'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Institution } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useDebounce } from '@/lib/useDebounce';
import { useTranslations } from '@/lib/useTranslations';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/providers/ToastProvider';
import { brand } from '@/lib/brand';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export default function ClaimInstitutionPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { showToast } = useToast();
  const t = useTranslations('onboarding.claim');
  const tBrand = useTranslations('brand.onboarding');

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const [results, setResults] = useState<Institution[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Institution | null>(null);
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

  const handleSelect = (institution: Institution) => {
    setSelected(institution);
    setResults([]);
  };

  const handleChange = () => {
    setSelected(null);
    setQuery('');
  };

  const handleNotListed = () => {
    // No "propose a new institution" endpoint exists on the backend today
    // (search only ever returns existing rows) — this is a placeholder
    // until one does.
    showToast(t('notListedToast', { email: brand.supportEmail }), 'info');
  };

  const handleClaim = async () => {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Two separate backend concerns: create the (pending) school_admin
      // persona scoped to this institution, then submit the claim itself
      // for platform-admin review. See app/onboarding/page.tsx's comment —
      // this is deliberately where persona creation for this path happens,
      // not the role-selection screen before it.
      await api.addPersona('school_admin', selected.id);
      await api.claimInstitution(selected.id);
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
          <p className={styles.brandLine}>{tBrand('school_admin_line')}</p>
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
                      <button type="button" className={styles.resultRow} onClick={() => handleSelect(institution)}>
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

              {!searching && debouncedQuery.trim().length >= MIN_QUERY_LENGTH && (
                <button type="button" className={styles.notListed} onClick={handleNotListed}>
                  {t('notListed')}
                </button>
              )}
            </div>
          )}

          {selected && (
            <div className={styles.selectedCard}>
              <div>
                <p className={styles.resultName}>{selected.name}</p>
                <p className={styles.resultMeta}>
                  {selected.type}
                  {selected.cityCode ? ` · ${selected.cityCode}` : ''} · {selected.countryCode}
                </p>
              </div>
              <button type="button" className={styles.changeLink} onClick={handleChange}>
                {t('changeLink')}
              </button>
            </div>
          )}

          {submitError && <ErrorMessage message={submitError} />}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!selected}
            loading={submitting}
            onClick={handleClaim}
          >
            {t('claimButton')}
          </Button>
        </div>
      </PageContainer>
    </AppShell>
  );
}
