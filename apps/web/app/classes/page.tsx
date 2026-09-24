'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Classroom, Institution, VerificationStatus } from '@alumini/types';
import * as api from '@/lib/api';
import type { ClassroomSearchResult } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useDebounce } from '@/lib/useDebounce';
import { useTranslations } from '@/lib/useTranslations';
import { useToast } from '@/components/providers/ToastProvider';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ClassroomCard, type ClassroomCardData } from '@/components/ClassroomCard';
import { ClassroomCreateForm } from '@/components/ClassroomCreateForm';
import { FilterChips } from '@/components/ui/FilterChips';
import styles from './page.module.css';

interface FlatClassroom extends Classroom {
  institution: Institution;
  verificationStatus: VerificationStatus;
}

function flatten(
  groups: Array<{ institution: Institution; classes: Array<Classroom & { verificationStatus: string }> }>,
): FlatClassroom[] {
  return groups
    .flatMap((group) => group.classes.map((c) => ({ ...c, institution: group.institution }) as FlatClassroom))
    // "Most recently active first" per the spec — there's no last-activity
    // timestamp anywhere in the schema (would need a per-classroom messages
    // query this list doesn't otherwise make), so createdAt is the closest
    // honest proxy available today. Documented approximation, not a bug.
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export default function ClassesPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { showToast } = useToast();
  const t = useTranslations('classes');
  const tCommon = useTranslations('common');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<FlatClassroom[]>([]);
  const [query, setQuery] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // ── Discovery — "Find your batch" (TASKS_07 TASK 07) ────────────────────
  const [discoveryQuery, setDiscoveryQuery] = useState('');
  const debouncedDiscoveryQuery = useDebounce(discoveryQuery, 300);
  const [discoveryResults, setDiscoveryResults] = useState<ClassroomSearchResult[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoverySearched, setDiscoverySearched] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Teacher mode already has its own dedicated filing-cabinet view
  // (grouped by institution, active/alumni sections) at /teacher — this
  // tab reuses that instead of reimplementing the same grouping here.
  useEffect(() => {
    if (ready && user?.activePersona === 'teacher') {
      router.replace('/teacher');
    }
  }, [ready, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMyClassrooms();
      setClassrooms(flatten(data));
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

  const institutionOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of classrooms) seen.set(c.institution.id, c.institution.name);
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [classrooms]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classrooms.filter((c) => {
      const matchesQuery = !q || c.name.toLowerCase().includes(q) || c.institution.name.toLowerCase().includes(q);
      const matchesInstitution = !institutionFilter || c.institution.id === institutionFilter;
      return matchesQuery && matchesInstitution;
    });
  }, [classrooms, query, institutionFilter]);

  const handleCreated = (globalId: string) => {
    setShowCreateForm(false);
    showToast(t('createdToast'), 'success');
    load();
    router.push(`/classroom/${globalId}`);
  };

  useEffect(() => {
    const q = debouncedDiscoveryQuery.trim();
    if (!q) {
      setDiscoveryResults([]);
      setDiscoveryError(null);
      setDiscoverySearched(false);
      return;
    }
    let cancelled = false;
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    api
      .searchClassrooms(q, 10)
      .then((results) => {
        if (!cancelled) {
          setDiscoveryResults(results);
          setDiscoverySearched(true);
        }
      })
      .catch((err) => {
        if (!cancelled) setDiscoveryError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setDiscoveryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedDiscoveryQuery]);

  const handleJoinDiscovered = async (result: ClassroomSearchResult) => {
    setJoiningId(result.id);
    try {
      await api.joinClassroom(result.id);
      setDiscoveryResults((prev) => prev.filter((r) => r.id !== result.id));
      showToast(
        result.verificationRequired ? t('discovery.requestedToast') : t('discovery.joinedToast'),
        'success',
      );
      load();
      router.push(`/classroom/${result.globalId}`);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setJoiningId(null);
    }
  };

  if (!ready || user?.activePersona === 'teacher') return null;

  return (
    <AppShell>
      <div className={styles.topBar}>
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
      </div>

      <PageContainer>
        {/* TASKS_08 TASK 01 — the search input (and institution filter)
            only make sense once there's something to search/filter; an
            empty classroom list rendered a pointless "Search your
            classrooms..." box above the empty state. */}
        {(loading || classrooms.length > 0) && (
          <>
            <Input
              label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.searchInput}
            />

            {institutionOptions.length > 1 && (
              <div className={styles.filterRow}>
                <FilterChips
                  options={institutionOptions}
                  value={institutionFilter}
                  onChange={setInstitutionFilter}
                  allLabel={tCommon('all')}
                />
              </div>
            )}
          </>
        )}

        {error && <ErrorMessage message={error} onRetry={load} />}

        {!error && (
          <div className={styles.list}>
            {loading && (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}

            {!loading && filtered.length === 0 && classrooms.length === 0 && (
              // No separate "Find your batch" CTA here — the discovery
              // section right below serves that purpose; a second button
              // with the same label doing something different (opening the
              // create form, not the search below) was the duplicate this
              // task was filed about.
              <EmptyState icon="🎓" title={t('empty.title')} description={t('empty.description')} />
            )}

            {!loading && filtered.length === 0 && classrooms.length > 0 && (
              <p className={styles.noResults}>{t('noResults')}</p>
            )}

            {!loading &&
              filtered.map((classroom) => (
                <ClassroomCard
                  key={classroom.id}
                  classroom={
                    {
                      globalId: classroom.globalId,
                      name: classroom.name,
                      batchYear: classroom.batchYear,
                      memberCount: classroom.memberCount,
                      institution: { name: classroom.institution.name, type: classroom.institution.type, cityCode: classroom.institution.cityCode, logoUrl: classroom.institution.logoUrl },
                      verificationStatus: classroom.verificationStatus,
                    } satisfies ClassroomCardData
                  }
                />
              ))}
          </div>
        )}

        <div className={styles.discoveryDivider} role="separator">
          <span className={styles.discoveryDividerLabel}>{t('discovery.dividerLabel')}</span>
        </div>

        <div className={styles.discoverySection}>
          <h2 className={styles.discoveryHeading}>{t('discovery.heading')}</h2>
          <Input
            label={t('discovery.searchLabel')}
            placeholder={t('discovery.searchPlaceholder')}
            value={discoveryQuery}
            onChange={(e) => setDiscoveryQuery(e.target.value)}
            className={styles.searchInput}
          />

          {discoveryLoading && (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}

          {discoveryError && !discoveryLoading && <ErrorMessage message={discoveryError} />}

          {!discoveryLoading && !discoveryError && !discoverySearched && !discoveryQuery.trim() && (
            <p className={styles.discoveryHint}>{t('discovery.emptyBeforeSearch')}</p>
          )}

          {!discoveryLoading && !discoveryError && discoverySearched && discoveryResults.length === 0 && (
            <div className={styles.discoveryHint}>
              <p>{t('discovery.noResults', { query: debouncedDiscoveryQuery })}</p>
              <button type="button" className={styles.discoveryCreateLink} onClick={() => setShowCreateForm(true)}>
                {t('discovery.createNewLink')}
              </button>
            </div>
          )}

          {!discoveryLoading && discoveryResults.length > 0 && (
            <div className={styles.discoveryList}>
              {discoveryResults.map((result) => (
                <div key={result.id} className={styles.discoveryCard}>
                  <div className={styles.discoveryCardInfo}>
                    <span className={styles.discoveryInstitution}>{result.institutionName}</span>
                    <span className={styles.discoveryClassroomName}>{result.name}</span>
                    <span className={styles.discoveryMeta}>
                      {result.batchYear} · {t('discovery.memberCount', { count: result.memberCount })}
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={joiningId === result.id}
                    onClick={() => handleJoinDiscovered(result)}
                  >
                    {result.verificationRequired ? t('discovery.requestToJoinButton') : t('discovery.joinButton')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {showCreateForm && (
          <div className={styles.inlineForm}>
            <div className={styles.inlineFormHeader}>
              <p className={styles.inlineFormTitle}>{t('newClassroomTitle')}</p>
              <button type="button" className={styles.inlineFormCancel} onClick={() => setShowCreateForm(false)}>
                {t('cancel')}
              </button>
            </div>
            <ClassroomCreateForm onDone={handleCreated} />
          </div>
        )}
      </PageContainer>

      {!showCreateForm && (
        <div className={styles.stickyBar}>
          <Button
            variant="primary"
            size="lg"
            className={styles.newClassroomButton}
            onClick={() => setShowCreateForm(true)}
          >
            {t('newClassroomButton')}
          </Button>
        </div>
      )}
    </AppShell>
  );
}
