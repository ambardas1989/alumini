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
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { SheetModal } from '@/components/ui/SheetModal';
import { MfaChallengeModal } from '@/components/MfaChallengeModal';
import styles from './VerifyTab.module.css';

interface VerifyTabProps {
  institutionId: string;
}

type StatusTab = 'pending' | 'approved' | 'rejected';
type PendingAction =
  | { kind: 'approve'; verificationIds: string[] }
  | { kind: 'reject'; verificationId: string; reason: string };

/**
 * TASKS_11 TASK 10 — ADAPTED onto /admin's existing Verify tab (see
 * admin/page.tsx's own comment) rather than a separate
 * /institution-admin/[institutionId]/verifications route. Broadened from
 * document-only/pending-only (InstitutionService.listVerifications(), new)
 * to every method/status; the actual approve/reject ACTIONS still go
 * through AdminController's existing MFA-gated document routes — not
 * duplicated here, and only meaningful for method='document' rows (the
 * other methods resolve themselves without admin review).
 */
export function VerifyTab({ institutionId }: VerifyTabProps) {
  const t = useTranslations('adminDashboard.verify');
  const { showToast } = useToast();

  const [statusTab, setStatusTab] = useState<StatusTab>('pending');
  const [classroomId, setClassroomId] = useState('');
  const [classrooms, setClassrooms] = useState<api.AdminClassroomEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<api.InstitutionVerificationRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadClassrooms = useCallback(async () => {
    try {
      const yearGroups = await api.getClassrooms(institutionId);
      setClassrooms(yearGroups.flatMap((g) => g.classrooms));
    } catch {
      // Non-fatal — the classroom filter dropdown just stays empty.
    }
  }, [institutionId]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    try {
      const result = await api.listInstitutionVerifications(institutionId, {
        status: statusTab,
        classroomId: classroomId || undefined,
        limit: 100,
      });
      setItems(result.verifications);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId, statusTab, classroomId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleViewDocument = async (verificationId: string) => {
    try {
      const { url } = await api.getDocumentUrl(institutionId, verificationId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.kind === 'approve') {
      for (const id of pendingAction.verificationIds) {
        setBusyId(id);
        try {
          await api.approveVerification(institutionId, id);
        } catch (err) {
          showToast(getErrorMessage(err), 'error');
        }
      }
      showToast(t('approvedToast'), 'success');
    } else {
      setBusyId(pendingAction.verificationId);
      try {
        await api.rejectVerification(institutionId, pendingAction.verificationId, pendingAction.reason);
        showToast(t('rejectedToast'), 'success');
      } catch (err) {
        showToast(getErrorMessage(err), 'error');
      }
    }
    setBusyId(null);
    setPendingAction(null);
    load();
  };

  const documentItems = items.filter((i) => i.method === 'document');

  if (loading) {
    return (
      <>
        <SkeletonCard />
        <SkeletonCard />
      </>
    );
  }

  if (error) return <ErrorMessage message={error} onRetry={load} fullPage />;

  return (
    <>
      <div className={styles.filterBar}>
        <div className={styles.statusTabs}>
          {(['pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.statusTab} ${statusTab === s ? styles.statusTabActive : ''}`}
              onClick={() => setStatusTab(s)}
            >
              {t(`statusTabs.${s}`)}
              {s === 'pending' && documentItems.length > 0 ? ` (${documentItems.length})` : ''}
            </button>
          ))}
        </div>
        <Select label={t('classroomFilterLabel')} value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
          <option value="">{t('allClassrooms')}</option>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {statusTab === 'pending' && documentItems.length > 1 && (
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          disabled={selectedIds.length === 0}
          onClick={() => setPendingAction({ kind: 'approve', verificationIds: selectedIds })}
        >
          {t('approveSelected', { count: selectedIds.length })}
        </Button>
      )}

      {items.length === 0 ? (
        <EmptyState icon="✅" title={t(`empty.${statusTab}Title`)} description={t(`empty.${statusTab}Description`)} />
      ) : (
        items.map((item) => (
          <div key={item.id} className={styles.card}>
            <div className={styles.header}>
              {statusTab === 'pending' && item.method === 'document' && (
                <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} />
              )}
              <Avatar avatarUrl={item.user?.avatar_url ?? null} fullName={item.user?.full_name ?? t('unknownUser')} size="md" />
              <div className={styles.headerText}>
                <p className={styles.name}>{item.user?.full_name ?? t('unknownUser')}</p>
                <p className={styles.meta}>
                  {item.user?.email ?? ''} · {item.classroom?.name ?? ''} · {item.classroom?.global_id ?? ''}
                </p>
              </div>
              <span className={styles.methodBadge}>{t(`methodLabels.${item.method}`)}</span>
            </div>
            <p className={styles.submitted}>{t('submitted', { time: safeRelativeTime(item.submittedAt) })}</p>

            {item.hasDocument && (
              <button type="button" className={styles.viewDoc} onClick={() => handleViewDocument(item.id)}>
                {t('viewDocument')}
              </button>
            )}

            {item.vouches.length > 0 && (
              <div className={styles.vouchList}>
                {item.vouches.map((v, i) => (
                  <span key={i} className={styles.vouchItem}>
                    {v.fullName ?? t('unknownUser')} ({v.role})
                  </span>
                ))}
              </div>
            )}

            {item.status === 'rejected' && item.rejectionReason && (
              <p className={styles.rejectionReason}>{t('rejectionReasonLabel', { reason: item.rejectionReason })}</p>
            )}

            {statusTab === 'pending' && item.method === 'document' && (
              <div className={styles.actions}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.rejectButton}
                  disabled={busyId === item.id}
                  onClick={() => {
                    setRejectTarget(item.id);
                    setRejectReason('');
                  }}
                >
                  {t('reject')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.approveButton}
                  loading={busyId === item.id}
                  onClick={() => setPendingAction({ kind: 'approve', verificationIds: [item.id] })}
                >
                  {t('approve')}
                </Button>
              </div>
            )}
          </div>
        ))
      )}

      {rejectTarget && (
        <SheetModal title={t('rejectModal.title')} onClose={() => setRejectTarget(null)}>
          <Textarea
            label={t('rejectModal.reasonLabel')}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
          <Button
            variant="danger"
            size="md"
            fullWidth
            disabled={!rejectReason.trim()}
            onClick={() => {
              setPendingAction({ kind: 'reject', verificationId: rejectTarget, reason: rejectReason.trim() });
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
