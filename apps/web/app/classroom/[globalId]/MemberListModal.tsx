'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import type { ClassroomMember, PendingClassroomVerification } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { useToast } from '@/components/providers/ToastProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SheetModal } from '@/components/ui/SheetModal';
import { MfaChallengeModal } from '@/components/MfaChallengeModal';
import styles from './MemberListModal.module.css';

interface MemberListModalProps {
  classroomId: string;
  members: ClassroomMember[];
  currentUserId: string;
  viewerIsVerified: boolean;
  /** classroom.createdBy — the one member shown as "Creator" instead of their plain role. */
  creatorId?: string | null;
  /** TASKS_09 TASK 10 — role='admin' or is_creator for the VIEWER, not the row being rendered. Gates the Verify/Reject buttons on pending document verifications. */
  viewerIsAdminOrCreator?: boolean;
  /** Optimistic badge update — Pending → Verified — on a successful approve. Rejection doesn't change verification_status (see rejectDocumentVerification's own comment), so no matching callback is needed for it. */
  onMemberVerified?: (userId: string) => void;
  /** TASKS_08 TASK 07 FIX B — opened from the Staff Room/Student Alley tab's "+" button restricts the roster to that role; omitted (Classroom tab) shows everyone. */
  roleFilter?: 'teacher' | 'student';
  onClose: () => void;
}

type MfaAction = { kind: 'approve'; verificationId: string; userId: string } | { kind: 'reject'; verificationId: string; userId: string; reason: string };

type Filter = 'all' | 'verified' | 'pending';

/** TASKS_04 TASK 07 — green=verified/pending_auto, amber=pending, muted for anything else (e.g. rejected). */
function statusDotClass(status: string): string {
  if (status === 'verified' || status === 'pending_auto') return styles.dotVerified!;
  if (status === 'pending') return styles.dotPending!;
  return styles.dotOther!;
}

export function MemberListModal({
  classroomId,
  members: allMembers,
  currentUserId,
  viewerIsVerified,
  creatorId,
  viewerIsAdminOrCreator,
  onMemberVerified,
  roleFilter,
  onClose,
}: MemberListModalProps) {
  const router = useRouter();
  const t = useTranslations('classroom.memberList');
  const tStatus = useTranslations('status');
  const { showToast } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [vouchedIds, setVouchedIds] = useState<Set<string>>(new Set());
  const [vouchingId, setVouchingId] = useState<string | null>(null);

  // ── TASKS_09 TASK 10 — admin document-verification review ───────────────
  const [pendingVerifications, setPendingVerifications] = useState<PendingClassroomVerification[]>([]);
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [mfaAction, setMfaAction] = useState<MfaAction | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!viewerIsAdminOrCreator) return;
    api
      .getPendingClassroomVerifications(classroomId)
      .then(setPendingVerifications)
      .catch(() => undefined); // Non-fatal — the list just shows no admin actions if this fails.
  }, [viewerIsAdminOrCreator, classroomId]);

  const runMfaAction = async () => {
    if (!mfaAction) return;
    setBusyUserId(mfaAction.userId);
    try {
      if (mfaAction.kind === 'approve') {
        await api.approveDocumentVerification(mfaAction.verificationId);
        showToast(t('admin.approvedToast'), 'success');
        onMemberVerified?.(mfaAction.userId);
      } else {
        await api.rejectDocumentVerification(mfaAction.verificationId, mfaAction.reason);
        showToast(t('admin.rejectedToast'), 'success');
      }
      setPendingVerifications((prev) => prev.filter((v) => v.userId !== mfaAction.userId));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusyUserId(null);
      setMfaAction(null);
    }
  };

  const members = useMemo(
    () => (roleFilter ? allMembers.filter((m) => m.role === roleFilter) : allMembers),
    [allMembers, roleFilter],
  );

  const counts = useMemo(
    () => ({
      all: members.length,
      verified: members.filter((m) => m.verificationStatus === 'verified').length,
      pending: members.filter((m) => m.verificationStatus === 'pending').length,
    }),
    [members],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return members;
    return members.filter((m) => m.verificationStatus === filter);
  }, [members, filter]);

  const handleVouch = async (member: ClassroomMember) => {
    setVouchingId(member.userId);
    try {
      await api.vouch(member.userId, classroomId);
      setVouchedIds((prev) => new Set(prev).add(member.userId));
      showToast(t('vouchSent', { name: member.fullName ?? '' }), 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setVouchingId(null);
    }
  };

  return (
    <SheetModal title={t('title', { count: members.length })} onClose={onClose}>
      <div className={styles.filters} role="tablist">
        {(['all', 'verified', 'pending'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={filter === option}
            className={`${styles.filterTab} ${filter === option ? styles.filterTabActive : ''}`}
            onClick={() => setFilter(option)}
          >
            {t(`filter.${option}`, { count: counts[option] })}
          </button>
        ))}
      </div>

      <ul className={styles.list}>
        {filtered.map((member) => {
          const isSelf = member.userId === currentUserId;
          const canVouch =
            viewerIsVerified && !isSelf && member.verificationStatus === 'pending';
          const alreadyVouched = vouchedIds.has(member.userId);

          const roleLabel = member.userId === creatorId ? tStatus('creator') : tStatus(member.role);

          const pendingVerification =
            viewerIsAdminOrCreator && member.verificationStatus === 'pending'
              ? pendingVerifications.find((v) => v.userId === member.userId)
              : undefined;
          const isBusy = busyUserId === member.userId;

          return (
            <li key={member.userId} className={styles.row}>
              <Avatar avatarUrl={member.avatarUrl} fullName={member.fullName ?? '?'} size="sm" />
              <div className={styles.info}>
                <p className={styles.name}>
                  {member.fullName}
                  {isSelf && <span className={styles.youTag}>{t('you')}</span>}
                  {member.linkedinConnected && (
                    <span className={styles.linkedinMark} aria-label={t('linkedinConnected')} title={t('linkedinConnected')}>
                      in
                    </span>
                  )}
                </p>
                <p className={styles.meta}>{t('roleStatus', { role: roleLabel, status: tStatus(member.verificationStatus) })}</p>
              </div>
              <span className={`${styles.statusDot} ${statusDotClass(member.verificationStatus)}`} aria-hidden="true" />
              <div className={styles.actions}>
                {canVouch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={alreadyVouched}
                    loading={vouchingId === member.userId}
                    onClick={() => handleVouch(member)}
                  >
                    {alreadyVouched ? t('vouched') : t('vouchFor', { name: member.fullName ?? '' })}
                  </Button>
                )}
                {!isSelf && (
                  <Button variant="ghost" size="sm" onClick={() => router.push(`/messages?userId=${member.userId}`)}>
                    {t('message')}
                  </Button>
                )}
                {pendingVerification && (
                  <>
                    {/* Ghost + color override, matching VerifyTab.tsx's identical
                        approve/reject buttons on the admin dashboard — no solid
                        green variant exists in the shared Button component. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.rejectButton}
                      disabled={isBusy}
                      onClick={() => {
                        setRejectingUserId((prev) => (prev === member.userId ? null : member.userId));
                        setRejectReason('');
                      }}
                    >
                      {t('admin.reject')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.approveButton}
                      loading={isBusy}
                      onClick={() =>
                        setMfaAction({ kind: 'approve', verificationId: pendingVerification.verificationId, userId: member.userId })
                      }
                    >
                      {t('admin.verify')}
                    </Button>
                  </>
                )}
              </div>
              {pendingVerification && rejectingUserId === member.userId && (
                <div className={styles.rejectRow}>
                  <Input
                    label={t('admin.reasonLabel')}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!rejectReason.trim()}
                    onClick={() => {
                      setMfaAction({
                        kind: 'reject',
                        verificationId: pendingVerification.verificationId,
                        userId: member.userId,
                        reason: rejectReason.trim(),
                      });
                      setRejectingUserId(null);
                    }}
                  >
                    {t('admin.confirmReject')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {mfaAction && (
        <MfaChallengeModal
          title={t('admin.mfaModal.title')}
          description={t('admin.mfaModal.description')}
          onCancel={() => setMfaAction(null)}
          onVerified={runMfaAction}
        />
      )}
    </SheetModal>
  );
}
