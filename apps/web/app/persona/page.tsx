'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Institution, Persona, PersonaType } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { PERSONA_ICONS } from '@/lib/personaMeta';
import { brand } from '@/lib/brand';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { Avatar } from '@/components/ui/Avatar';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import styles from './page.module.css';

const DESTINATION: Record<PersonaType, string> = {
  alumni: '/',
  teacher: '/teacher',
  school_admin: '/admin',
};

export default function PersonaSwitcherPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const t = useTranslations('personaSwitcher');
  const tTypes = useTranslations('personaTypes');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [subLabels, setSubLabels] = useState<Record<string, string>>({});
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [personaList, classroomGroups] = await Promise.all([api.getPersonas(), api.getMyClassrooms()]);
      setPersonas(personaList);

      const institutionMap: Record<string, Institution> = {};
      classroomGroups.forEach((g) => {
        institutionMap[g.institution.id] = g.institution;
      });

      const labels: Record<string, string> = {};
      for (const persona of personaList) {
        if (persona.type === 'alumni') {
          const count = classroomGroups
            .flatMap((g) => g.classes)
            .filter((c) => c.userRole !== 'teacher').length;
          labels[persona.id] = t('subLabel.alumni', { count });
        } else if (persona.type === 'teacher') {
          const teacherClasses = classroomGroups.flatMap((g) =>
            g.classes.filter((c) => c.userRole === 'teacher').map(() => g.institution.id),
          );
          const schoolCount = new Set(teacherClasses).size;
          labels[persona.id] = t('subLabel.teacher', { classes: teacherClasses.length, schools: schoolCount });
        } else {
          // No "get institution by id" endpoint exists — falls back to the
          // institution map built from classrooms above (works only if
          // this admin also has classrooms there), else a generic label.
          const institution = persona.institutionId ? institutionMap[persona.institutionId] : undefined;
          labels[persona.id] = institution?.name ?? t('subLabel.schoolAdminFallback');
        }
      }
      setSubLabels(labels);
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const handleSwitch = async (persona: Persona) => {
    setSwitchingId(persona.id);
    try {
      const result = await api.switchPersona(persona.type);
      updateUser({ activePersona: result.activePersona });
      showToast(t('switchedToast', { type: tTypes(persona.type) }), 'success');
      router.push(DESTINATION[persona.type]);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
      setSwitchingId(null);
    }
  };

  if (!ready) return null;

  return (
    <AppShell showNav={false}>
      <PageHeader title={t('title')} showBack />
      <PageContainer>
        {loading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {!loading && loadError && <ErrorMessage message={loadError} fullPage onRetry={load} />}

        {!loading && !loadError && user && (
          <>
            <div className={styles.accountStrip}>
              <Avatar avatarUrl={user.avatarUrl} fullName={user.fullName} size="lg" />
              <p className={styles.accountName}>{user.fullName}</p>
              <p className={styles.accountEmail}>{user.email}</p>
              <p className={styles.personaCount}>{t('personaCount', { count: personas.length })}</p>
            </div>

            <div className={styles.list}>
              {personas.map((persona) => {
                const isActive = persona.type === user.activePersona;
                const isPending = persona.status === 'pending_approval' || persona.status === 'suspended';
                const isSwitching = switchingId === persona.id;

                if (isActive) {
                  return (
                    <div key={persona.id} className={`${styles.card} ${styles.cardActive}`}>
                      <span className={`${styles.iconCircle} ${styles.iconCircleActive}`} aria-hidden="true">
                        {PERSONA_ICONS[persona.type]}
                      </span>
                      <div className={styles.cardBody}>
                        <p className={styles.cardTitleActive}>{tTypes(persona.type)}</p>
                        <p className={styles.cardSubActive}>{subLabels[persona.id]}</p>
                        <p className={styles.brandLineActive}>{brand.onboardingLines[persona.type]}</p>
                      </div>
                      <span className={styles.activeBadge}>{t('activeBadge')}</span>
                    </div>
                  );
                }

                if (isPending) {
                  return (
                    <div key={persona.id} className={`${styles.card} ${styles.cardPending}`}>
                      <span className={styles.iconCircle} aria-hidden="true">
                        {PERSONA_ICONS[persona.type]}
                      </span>
                      <div className={styles.cardBody}>
                        <p className={styles.cardTitle}>{tTypes(persona.type)}</p>
                        <p className={styles.cardSubPending}>{t('awaitingApproval')}</p>
                      </div>
                      <span className={styles.pendingBadge}>{t('underReviewBadge')}</span>
                    </div>
                  );
                }

                return (
                  <button
                    key={persona.id}
                    type="button"
                    className={styles.card}
                    disabled={isSwitching}
                    onClick={() => handleSwitch(persona)}
                  >
                    <span className={styles.iconCircle} aria-hidden="true">
                      {PERSONA_ICONS[persona.type]}
                    </span>
                    <div className={styles.cardBody}>
                      <p className={styles.cardTitle}>{tTypes(persona.type)}</p>
                      <p className={styles.cardSub}>{subLabels[persona.id]}</p>
                      <p className={styles.brandLineMuted}>{brand.onboardingLines[persona.type]}</p>
                    </div>
                    {isSwitching ? <LoadingSpinner size="sm" /> : <span className={styles.switchBadge}>{t('switchBadge')}</span>}
                  </button>
                );
              })}

              <button type="button" className={styles.addCard} onClick={() => router.push('/onboarding')}>
                <span className={styles.addIcon} aria-hidden="true">
                  +
                </span>
                <div className={styles.cardBody}>
                  <p className={styles.addTitle}>{t('addPersona.title')}</p>
                  <p className={styles.addSub}>{t('addPersona.description')}</p>
                </div>
              </button>
            </div>

            <p className={styles.infoNote}>{t('infoNote')}</p>
          </>
        )}
      </PageContainer>
    </AppShell>
  );
}
