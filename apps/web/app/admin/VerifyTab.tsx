'use client';

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { SheetModal } from '@/components/ui/SheetModal';
import { MfaChallengeModal } from '@/components/MfaChallengeModal';
import styles from './VerifyTab.module.css';

interface VerifyTabProps {
  institutionId: string;
}

type PendingAction = { kind: 'approve'; verificationId: string } | { kind: 'reject'; verificationId: string; reason: string };

export function VerifyTab({ institutionId }: VerifyTabProps) {
  const t = useTranslations('adminDashboard.verify');
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<api.PendingDocumentVerification[]>([]);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.getPendingVerifications(institutionId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

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

  const runAction = async () => {
    if (!pendingAction) return;
    setBusyId(pendingAction.verificationId);
    try {
      if (pendingAction.kind === 'approve') {
        await api.approveVerification(institutionId, pendingAction.verificationId);
        showToast(t('approvedToast'), 'success');
      } else {
        await api.rejectVerification(institutionId, pendingAction.verificationId, pendingAction.reason);
        showToast(t('rejectedToast'), 'success');
      }
      setItems((prev) => prev.filter((i) => i.verificationId !== pendingAction.verificationId));
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
    return <EmptyState icon="✅" title={t('empty.title')} description={t('empty.description')} />;
  }

  return (
    <>
      {items.map((item) => (
        <div key={item.verificationId} className={styles.card}>
          <div className={styles.header}>
            <Avatar avatarUrl={null} fullName={item.userDisplayName} size="md" />
            <div className={styles.headerText}>
              <p className={styles.name}>{item.userDisplayName}</p>
              <p className={styles.meta}>{item.classroomName}</p>
            </div>
            <span className={styles.methodBadge}>{t('methodBadge')}</span>
          </div>
          <p className={styles.submitted}>{t('submitted', { time: formatRelativeTime(item.submittedAt) })}</p>

          <button type="button" className={styles.viewDoc} onClick={() => handleViewDocument(item.verificationId)}>
            {t('viewDocument')}
          </button>

          <div className={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              className={styles.rejectButton}
              disabled={busyId === item.verificationId}
              onClick={() => {
                setRejectTarget(item.verificationId);
                setRejectReason('');
              }}
            >
              {t('reject')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={styles.approveButton}
              loading={busyId === item.verificationId}
              onClick={() => setPendingAction({ kind: 'approve', verificationId: item.verificationId })}
            >
              {t('approve')}
            </Button>
          </div>
        </div>
      ))}

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
