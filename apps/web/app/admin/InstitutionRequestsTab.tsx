'use client';

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeRelativeTime } from '@/lib/format';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { SheetModal } from '@/components/ui/SheetModal';
import { MfaChallengeModal } from '@/components/MfaChallengeModal';
import styles from './VerifyTab.module.css';

type PendingAction =
  | { kind: 'approve'; requestId: string; slug: string; cityCode?: string; emailDomain?: string }
  | { kind: 'reject'; requestId: string; reason: string };

/**
 * Platform-admin-only — see AdminDashboardPage's own gating. Mirrors
 * VerifyTab's card/modal/MFA-challenge shape (same review-queue pattern,
 * different resource) rather than inventing a new one.
 */
export function InstitutionRequestsTab() {
  const t = useTranslations('adminDashboard.institutionRequests');
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<api.AdminInstitutionRequestRow[]>([]);

  const [approveTarget, setApproveTarget] = useState<api.AdminInstitutionRequestRow | null>(null);
  const [slug, setSlug] = useState('');
  const [cityCode, setCityCode] = useState('');
  const [emailDomain, setEmailDomain] = useState('');

  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.adminListInstitutionRequests('pending'));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async () => {
    if (!pendingAction) return;
    setBusyId(pendingAction.requestId);
    try {
      if (pendingAction.kind === 'approve') {
        await api.adminApproveInstitutionRequest(
          pendingAction.requestId,
          pendingAction.slug,
          pendingAction.cityCode || undefined,
          pendingAction.emailDomain || undefined,
        );
        showToast(t('approvedToast'), 'success');
      } else {
        await api.adminRejectInstitutionRequest(pendingAction.requestId, pendingAction.reason);
        showToast(t('rejectedToast'), 'success');
      }
      setItems((prev) => prev.filter((i) => i.id !== pendingAction.requestId));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusyId(null);
      setPendingAction(null);
    }
  };

  if (loading) {
    return (
      <>
        <SkeletonCard />
        <SkeletonCard />
      </>
    );
  }

  if (error) return <ErrorMessage message={error} onRetry={load} fullPage />;

  if (items.length === 0) {
    return <EmptyState icon="🏫" title={t('empty.title')} description={t('empty.description')} />;
  }

  return (
    <>
      {items.map((item) => (
        <div key={item.id} className={styles.card}>
          <p className={styles.name}>
            {item.name} <span className={styles.meta}>· {item.type}</span>
          </p>
          {item.city && <p className={styles.meta}>{item.city}</p>}
          <p className={styles.meta}>{t('requestedBy', { name: item.requester?.full_name ?? 'Unknown' })}</p>
          <p className={styles.submitted}>{t('submitted', { time: safeRelativeTime(item.created_at) })}</p>

          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={busyId === item.id}
              onClick={() => {
                setRejectTarget(item.id);
                setRejectReason('');
              }}
            >
              {t('reject')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busyId === item.id}
              onClick={() => {
                setApproveTarget(item);
                setSlug('');
                setCityCode(item.city_code ?? '');
                setEmailDomain(item.email_domain ?? '');
              }}
            >
              {t('approve')}
            </Button>
          </div>
        </div>
      ))}

      {approveTarget && (
        <SheetModal title={t('approveModal.title', { name: approveTarget.name })} onClose={() => setApproveTarget(null)}>
          <Input label={t('approveModal.slugLabel')} value={slug} onChange={(e) => setSlug(e.target.value.toUpperCase())} />
          <Input label={t('approveModal.cityCodeLabel')} value={cityCode} onChange={(e) => setCityCode(e.target.value.toUpperCase())} />
          <Input label={t('approveModal.emailDomainLabel')} value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} />
          <Button
            variant="primary"
            size="md"
            fullWidth
            disabled={!slug.trim()}
            onClick={() => {
              setPendingAction({
                kind: 'approve',
                requestId: approveTarget.id,
                slug: slug.trim(),
                cityCode: cityCode.trim(),
                emailDomain: emailDomain.trim(),
              });
              setApproveTarget(null);
            }}
          >
            {t('approveModal.submit')}
          </Button>
        </SheetModal>
      )}

      {rejectTarget && (
        <SheetModal title={t('rejectModal.title')} onClose={() => setRejectTarget(null)}>
          <Textarea label={t('rejectModal.reasonLabel')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} />
          <Button
            variant="danger"
            size="md"
            fullWidth
            disabled={!rejectReason.trim()}
            onClick={() => {
              setPendingAction({ kind: 'reject', requestId: rejectTarget, reason: rejectReason.trim() });
              setRejectTarget(null);
            }}
          >
            {t('rejectModal.submit')}
          </Button>
        </SheetModal>
      )}

      {pendingAction && (
        <MfaChallengeModal
          title={t('mfaModal.title')}
          description={t('mfaModal.description')}
          onCancel={() => setPendingAction(null)}
          onVerified={runAction}
        />
      )}
    </>
  );
}
