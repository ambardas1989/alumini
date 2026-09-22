'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Classroom, Institution, VerificationStatus } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
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

  if (!ready || user?.activePersona === 'teacher') return null;

  return (
    <AppShell>
      <div className={styles.topBar}>
        <h1 className={styles.topBarTitle}>{t('title')}</h1>
      </div>

      <PageContainer>
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
              <EmptyState
                icon="🎓"
                title={t('empty.title')}
                description={t('empty.description')}
                ctaLabel={t('empty.cta')}
                onCta={() => setShowCreateForm(true)}
              />
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
                      institution: { name: classroom.institution.name, type: classroom.institution.type, cityCode: classroom.institution.cityCode },
                      verificationStatus: classroom.verificationStatus,
                    } satisfies ClassroomCardData
                  }
                />
              ))}
          </div>
        )}

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
