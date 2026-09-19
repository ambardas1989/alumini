'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Classroom, Institution } from '@alumini/types';
import * as api from '@/lib/api';
import type { MembershipDetail, VerificationAttempt } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { MethodAccordion } from './MethodAccordion';
import { EmailMethod } from './EmailMethod';
import { VouchMethod } from './VouchMethod';
import { DocumentMethod } from './DocumentMethod';
import { LinkedInMethod } from './LinkedInMethod';
import { CodeMethod } from './CodeMethod';
import { StatusBar } from './StatusBar';
import { SuccessState } from './SuccessState';
import type { MethodStatus } from './types';
import styles from './page.module.css';

type ClassroomDetail = Classroom & { institution: Institution };
type MethodKey = 'email' | 'peer_vouch' | 'document' | 'linkedin' | 'personal_code' | 'batch_code';

const METHOD_ORDER: MethodKey[] = ['email', 'peer_vouch', 'document', 'linkedin', 'personal_code', 'batch_code'];

export default function VerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const classroomId = searchParams.get('classroomId');
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { showToast } = useToast();
  const t = useTranslations('verification');
  const tCommon = useTranslations('common');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [membership, setMembership] = useState<MembershipDetail | null>(null);
  const [latestAttempt, setLatestAttempt] = useState<VerificationAttempt | null>(null);

  const [expanded, setExpanded] = useState<MethodKey | null>(null);

  const load = useCallback(async () => {
    if (!classroomId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [classroomData, membershipData] = await Promise.all([
        api.getClassroom(classroomId),
        api.getMembership(classroomId),
      ]);
      setClassroom(classroomData);
      setMembership(membershipData);

      // getVerificationStatus() needs the membership row id getMembership()
      // just gave us — no route exposes it any other way (see lib/api.ts's
      // getMembership() comment).
      try {
        const status = await api.getVerificationStatus(membershipData.id);
        setLatestAttempt(status.latestAttempt);
      } catch {
        // Non-fatal — the accordion just falls back to no in-progress method highlighted.
      }
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [classroomId]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const handleVerified = () => {
    showToast(t('verifiedToast'), 'success');
    load();
  };

  const handleDocumentSubmitted = () => {
    showToast(t('documentSubmittedToast'), 'success');
    load();
  };

  const methodStatus = (key: MethodKey): MethodStatus => {
    if (membership?.verification_status === 'verified' && membership.verification_method === key) return 'complete';
    if (latestAttempt?.method === key && latestAttempt.status === 'pending') return 'inProgress';
    return 'idle';
  };

  const methodLabel = (key: MethodKey) => t(`methods.${key}.label`);

  if (!ready) return null;

  if (!classroomId) {
    return (
      <AppShell showNav={false}>
        <PageHeader title={t('title')} showBack />
        <ErrorMessage message={tCommon('error')} fullPage />
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell showNav={false}>
        <PageHeader title={t('title')} showBack />
        <div className={styles.centeredLoading}>
          <LoadingSpinner size="lg" />
        </div>
      </AppShell>
    );
  }

  if (loadError || !classroom || !membership) {
    return (
      <AppShell showNav={false}>
        <PageHeader title={t('title')} showBack />
        <ErrorMessage message={loadError ?? tCommon('error')} fullPage onRetry={load} />
      </AppShell>
    );
  }

  const isVerified = membership.verification_status === 'verified';

  if (isVerified) {
    return (
      <AppShell showNav={false}>
        <PageHeader title={t('title')} showBack />
        <SuccessState
          method={membership.verification_method ? methodLabel(membership.verification_method as MethodKey) : null}
          verifiedAt={membership.verified_at}
          onGoToClassroom={() => router.push(`/classroom/${classroom.globalId}`)}
        />
      </AppShell>
    );
  }

  // Badge has no dedicated neutral/gray variant — 'student' renders as
  // var(--color-border)/var(--color-text-secondary) (see Badge.module.css),
  // which is exactly the muted gray this "not verified" badge needs, reused
  // for its color rather than its role semantics.
  const statusBadge: { variant: BadgeVariant; label: string } =
    latestAttempt?.status === 'pending'
      ? { variant: 'pending', label: t('statusPending') }
      : { variant: 'student', label: t('statusNotVerified') };

  return (
    <AppShell showNav={false}>
      <PageHeader title={t('title')} showBack />
      <PageContainer noPadding>
        <div className={styles.scroll}>
          <div className={styles.contextCard}>
            <p className={styles.institutionName}>{classroom.institution.name}</p>
            <p className={styles.classroomName}>{classroom.name}</p>
            <div className={styles.contextMeta}>
              <span>{classroom.batchYear}</span>
              <Badge variant={statusBadge.variant} label={statusBadge.label} />
            </div>
          </div>

          <p className={styles.progressNote}>
            {latestAttempt?.status === 'pending'
              ? t('progressInProgress', { method: methodLabel(latestAttempt.method as MethodKey) })
              : t('progressDefault')}
          </p>

          <div className={styles.methods}>
            <MethodAccordion
              number={1}
              title={t('methods.email.label')}
              status={methodStatus('email')}
              expanded={expanded === 'email'}
              onToggle={() => setExpanded((e) => (e === 'email' ? null : 'email'))}
            >
              <EmailMethod
                classroomId={classroomId}
                institutionName={classroom.institution.name}
                emailDomain={classroom.institution.emailDomain ?? null}
                onVerified={handleVerified}
              />
            </MethodAccordion>

            <MethodAccordion
              number={2}
              title={t('methods.vouch.label')}
              status={methodStatus('peer_vouch')}
              headerExtra={
                latestAttempt?.method === 'peer_vouch'
                  ? t('vouchPointsHeader', { points: latestAttempt.vouch_points })
                  : undefined
              }
              expanded={expanded === 'peer_vouch'}
              onToggle={() => setExpanded((e) => (e === 'peer_vouch' ? null : 'peer_vouch'))}
            >
              <VouchMethod userId={user?.id ?? ''} vouchPoints={latestAttempt?.method === 'peer_vouch' ? latestAttempt.vouch_points : 0} />
            </MethodAccordion>

            <MethodAccordion
              number={3}
              title={t('methods.document.label')}
              status={methodStatus('document')}
              expanded={expanded === 'document'}
              onToggle={() => setExpanded((e) => (e === 'document' ? null : 'document'))}
            >
              <DocumentMethod
                classroomId={classroomId}
                initialPhase={
                  latestAttempt?.method === 'document'
                    ? latestAttempt.status === 'rejected'
                      ? 'rejected'
                      : latestAttempt.status === 'pending'
                        ? 'pending'
                        : 'upload'
                    : 'upload'
                }
                rejectionReason={latestAttempt?.method === 'document' ? latestAttempt.rejection_reason : null}
                submittedDate={latestAttempt?.method === 'document' ? latestAttempt.created_at : null}
                onVerified={handleVerified}
                onSubmitted={handleDocumentSubmitted}
              />
            </MethodAccordion>

            <MethodAccordion
              number={4}
              title={t('methods.linkedin.label')}
              status={methodStatus('linkedin')}
              expanded={expanded === 'linkedin'}
              onToggle={() => setExpanded((e) => (e === 'linkedin' ? null : 'linkedin'))}
            >
              <LinkedInMethod
                classroomId={classroomId}
                institutionName={classroom.institution.name}
                batchYear={classroom.batchYear}
                onVerified={handleVerified}
              />
            </MethodAccordion>

            <MethodAccordion
              number={5}
              title={t('methods.personalCode.label')}
              status={methodStatus('personal_code')}
              expanded={expanded === 'personal_code'}
              onToggle={() => setExpanded((e) => (e === 'personal_code' ? null : 'personal_code'))}
            >
              <CodeMethod classroomId={classroomId} onVerified={handleVerified} />
            </MethodAccordion>

            <MethodAccordion
              number={6}
              title={t('methods.batchCode.label')}
              status={methodStatus('batch_code')}
              expanded={expanded === 'batch_code'}
              onToggle={() => setExpanded((e) => (e === 'batch_code' ? null : 'batch_code'))}
            >
              <CodeMethod classroomId={classroomId} onVerified={handleVerified} />
            </MethodAccordion>
          </div>
        </div>
      </PageContainer>

      <StatusBar
        status={latestAttempt?.status === 'pending' ? 'pending' : 'notVerified'}
        methodLabel={latestAttempt ? methodLabel(latestAttempt.method as MethodKey) : undefined}
        onGoToClassroom={() => router.push(`/classroom/${classroom.globalId}`)}
      />
    </AppShell>
  );
}
