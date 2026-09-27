'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Institution } from '@alumini/types';
import * as api from '@/lib/api';
import type { ClassroomFilterSearchResult } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useDebounce } from '@/lib/useDebounce';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { COMMON_COUNTRIES, OTHER_COUNTRIES } from '@/lib/countries';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ClassroomCreateForm } from '@/components/ClassroomCreateForm';
import styles from './page.module.css';

const MIN_INSTITUTION_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const CURRENT_YEAR = new Date().getFullYear();
const BATCH_YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1960 + 1 }, (_, i) => CURRENT_YEAR - i);

type Section = 'find' | 'create';

/** TASKS_09 TASK 19 — Connect tab: "Find your batch" (structured classroom search) + "Create a classroom", one-open-at-a-time accordion. */
export default function ConnectPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { showToast } = useToast();
  const t = useTranslations('connect');
  const tCommon = useTranslations('common');

  // Always opens with Find expanded — plain useState, no persistence, so a
  // fresh mount (tab re-navigation) always resets to this default.
  const [openSection, setOpenSection] = useState<Section>('find');

  // ── Find your batch ──────────────────────────────────────────────────────
  const [institutionQuery, setInstitutionQuery] = useState('');
  const debouncedInstitutionQuery = useDebounce(institutionQuery, DEBOUNCE_MS);
  const [institutionResults, setInstitutionResults] = useState<Institution[]>([]);
  const [institutionSearching, setInstitutionSearching] = useState(false);
  const [selectedInstitution, setSelectedInstitution] = useState<Institution | null>(null);

  const [country, setCountry] = useState('IN');
  const [city, setCity] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<ClassroomFilterSearchResult[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedInstitution || debouncedInstitutionQuery.trim().length < MIN_INSTITUTION_QUERY_LENGTH) {
      setInstitutionResults([]);
      return;
    }
    let cancelled = false;
    setInstitutionSearching(true);
    api
      .searchInstitutions(debouncedInstitutionQuery.trim(), country)
      .then((data) => {
        if (!cancelled) setInstitutionResults(data.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setInstitutionResults([]);
      })
      .finally(() => {
        if (!cancelled) setInstitutionSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedInstitutionQuery, selectedInstitution, country]);

  const handleSelectInstitution = (institution: Institution) => {
    setSelectedInstitution(institution);
    setInstitutionQuery('');
    setInstitutionResults([]);
    if (institution.countryCode) setCountry(institution.countryCode);
  };

  const handleSearch = async () => {
    if (!selectedInstitution) return;
    setSearching(true);
    setSearchError(null);
    try {
      const data = await api.searchClassroomsByFilters({
        institutionId: selectedInstitution.id,
        country: country || undefined,
        city: city.trim() || undefined,
        year: year ? parseInt(year, 10) : undefined,
        section: section.trim() || undefined,
        limit: 20,
      });
      setResults(data);
      setSearched(true);
    } catch (err) {
      setSearchError(getErrorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  const handleJoin = async (result: ClassroomFilterSearchResult) => {
    setJoiningId(result.id);
    try {
      await api.joinClassroom(result.id);
      setResults((prev) => prev.filter((r) => r.id !== result.id));
      showToast(t('find.joinedToast'), 'success');
      router.push(`/classroom/${result.globalId}`);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setJoiningId(null);
    }
  };

  const handleCreated = (globalId: string) => {
    showToast(t('create.successToast'), 'success');
    router.push(`/classroom/${globalId}`);
  };

  if (!ready) return null;

  return (
    <AppShell>
      <PageContainer>
        <h1 className={styles.pageTitle}>{t('title')}</h1>

        <div className={styles.accordion}>
          <button
            type="button"
            className={styles.accordionHeader}
            onClick={() => setOpenSection('find')}
            aria-expanded={openSection === 'find'}
          >
            <span className={`${styles.chevron} ${openSection === 'find' ? styles.chevronOpen : ''}`}>▶</span>
            {t('find.heading')}
          </button>
          <div className={`${styles.accordionBody} ${openSection === 'find' ? styles.accordionBodyOpen : ''}`}>
            <div className={styles.accordionContent}>
              {!selectedInstitution ? (
                <div className={styles.searchWrap}>
                  <Input
                    label={`${t('find.institutionLabel')} *`}
                    placeholder={t('find.institutionPlaceholder')}
                    value={institutionQuery}
                    onChange={(e) => setInstitutionQuery(e.target.value)}
                  />
                  {institutionSearching && (
                    <div className={styles.searchStatus}>
                      <SkeletonCard />
                    </div>
                  )}
                  {!institutionSearching && institutionResults.length > 0 && (
                    <ul className={styles.institutionResults}>
                      {institutionResults.map((institution) => (
                        <li key={institution.id}>
                          <button type="button" className={styles.institutionResultRow} onClick={() => handleSelectInstitution(institution)}>
                            <span className={styles.institutionName}>{institution.name}</span>
                            <span className={styles.institutionMeta}>
                              {institution.cityCode ? `${institution.cityCode} · ` : ''}
                              {institution.type}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className={styles.selectedInstitution}>
                  <span className={styles.institutionName}>{selectedInstitution.name}</span>
                  <button type="button" className={styles.changeLink} onClick={() => setSelectedInstitution(null)}>
                    {tCommon('change')}
                  </button>
                </div>
              )}

              <Select label={t('find.countryLabel')} value={country} onChange={(e) => setCountry(e.target.value)}>
                <optgroup label={t('find.commonCountries')}>
                  {COMMON_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('find.otherCountries')}>
                  {OTHER_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              </Select>

              <Input label={t('find.cityLabel')} placeholder={t('find.cityPlaceholder')} value={city} onChange={(e) => setCity(e.target.value)} />

              <Select label={t('find.yearLabel')} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">{t('find.yearAny')}</option>
                {BATCH_YEAR_OPTIONS.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </Select>

              <Input
                label={t('find.sectionLabel')}
                placeholder={t('find.sectionPlaceholder')}
                value={section}
                onChange={(e) => setSection(e.target.value)}
              />

              <Button variant="primary" size="lg" fullWidth disabled={!selectedInstitution} loading={searching} onClick={handleSearch}>
                {t('find.searchButton')}
              </Button>

              {searchError && <ErrorMessage message={searchError} onRetry={handleSearch} />}

              {searching && (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              )}

              {!searching && searched && results.length === 0 && <p className={styles.emptyText}>{t('find.noResults')}</p>}

              {!searching && results.length > 0 && (
                <div className={styles.results}>
                  {results.map((result) => (
                    <div key={result.id} className={styles.resultCard}>
                      <div className={styles.resultInfo}>
                        <span className={styles.resultName}>
                          {result.institutionName} · {result.name} · {result.batchYear}
                        </span>
                        <span className={styles.resultMeta}>
                          {t('find.memberCount', { count: result.memberCount })}
                          {result.verificationRequired ? ` · ${t('find.verificationRequired')}` : ''}
                        </span>
                      </div>
                      <Button variant="ghost" size="sm" loading={joiningId === result.id} onClick={() => handleJoin(result)}>
                        {t('find.joinButton')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            className={styles.accordionHeader}
            onClick={() => setOpenSection('create')}
            aria-expanded={openSection === 'create'}
          >
            <span className={`${styles.chevron} ${openSection === 'create' ? styles.chevronOpen : ''}`}>▶</span>
            {t('create.heading')}
          </button>
          <div className={`${styles.accordionBody} ${openSection === 'create' ? styles.accordionBodyOpen : ''}`}>
            <div className={styles.accordionContent}>
              <ClassroomCreateForm onDone={handleCreated} />
            </div>
          </div>
        </div>
      </PageContainer>
    </AppShell>
  );
}
