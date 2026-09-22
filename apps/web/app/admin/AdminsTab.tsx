'use client';

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate } from '@/lib/format';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { MfaChallengeModal } from '@/components/MfaChallengeModal';
import styles from './AdminsTab.module.css';
import tabStyles from './Tab.module.css';

interface AdminsTabProps {
  institutionId: string;
}

const MAX_ADMIN_SLOTS = 5;

export function AdminsTab({ institutionId }: AdminsTabProps) {
  const t = useTranslations('adminDashboard.admins');
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [admins, setAdmins] = useState<api.InstitutionAdminRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<api.InstitutionAdminInvite[]>([]);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<api.InstitutionAdminRow | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAdmins(institutionId);
      setAdmins(data.admins);
      setPendingInvites(data.pendingInvites);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const usedSlots = admins.length + pendingInvites.length;

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api.inviteAdmin(institutionId, inviteEmail.trim());
      showToast(t('invite.successToast'), 'success');
      setInviteEmail('');
      setInviteOpen(false);
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setInviting(false);
    }
  };

  const runRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.removeAdmin(institutionId, removeTarget.user_id, removeReason.trim());
      showToast(t('remove.successToast'), 'success');
      setAdmins((prev) => prev.filter((a) => a.user_id !== removeTarget.user_id));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
      setConfirmingRemove(false);
      setRemoveReason('');
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

  return (
    <>
      <div className={styles.slotBar}>
        <div className={styles.slotTrack}>
          <div
            className={`${styles.slotFill} ${usedSlots >= MAX_ADMIN_SLOTS ? styles.slotFillFull : ''}`}
            style={{ width: `${Math.min(100, (usedSlots / MAX_ADMIN_SLOTS) * 100)}%` }}
          />
        </div>
        <p className={styles.slotLabel}>{t('slotUsage', { used: usedSlots, max: MAX_ADMIN_SLOTS })}</p>
      </div>

      <p className={tabStyles.sectionLabel}>{t('activeAdmins')}</p>
      {admins.map((admin) => (
        <div key={admin.id} className={styles.row}>
          <Avatar avatarUrl={admin.profile?.avatar_url} fullName={admin.profile?.full_name ?? t('unknownAdmin')} size="md" />
          <span className={styles.rowText}>
            <span className={styles.rowName}>{admin.profile?.full_name ?? t('unknownAdmin')}</span>
            {/* Admin rows carry no email — institution.service.ts's listAdmins()
                doesn't select profiles.email, only pending invites have one. */}
            <span className={styles.rowMeta}>
              {admin.is_primary_admin ? t('primaryBadge') : t('coAdminBadge')}
            </span>
          </span>
          {!admin.is_primary_admin && (
            <div className={styles.menuWrap}>
              <button
                type="button"
                className={styles.menuButton}
                aria-label={t('menuLabel')}
                onClick={() => setOpenMenuId(openMenuId === admin.id ? null : admin.id)}
              >
                ⋯
              </button>
              {openMenuId === admin.id && (
                <div className={styles.menu}>
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setOpenMenuId(null);
                      setRemoveTarget(admin);
                      setRemoveReason('');
                    }}
                  >
                    {t('removeAction')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {pendingInvites.length > 0 && (
        <>
          <p className={tabStyles.sectionLabel}>{t('pendingInvites')}</p>
          {pendingInvites.map((invite) => (
            <div key={invite.id} className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{invite.email}</span>
                <span className={styles.rowMeta}>{t('inviteExpires', { date: safeFormatDate(invite.expires_at) })}</span>
              </span>
              {/* No resend/cancel-invite endpoint exists on the backend
                  (institution.controller.ts has invite + admin-remove only,
                  no route for a pending invite) — this discloses the gap
                  rather than faking a working action. */}
              <button
                type="button"
                className={styles.cancelInvite}
                onClick={() => showToast(t('cancelInviteUnavailable'), 'info')}
              >
                {t('cancelInvite')}
              </button>
            </div>
          ))}
        </>
      )}

      {usedSlots < MAX_ADMIN_SLOTS ? (
        <Button variant="secondary" size="md" fullWidth onClick={() => setInviteOpen(true)}>
          {t('invite.cta')}
        </Button>
      ) : (
        <p className={styles.slotsFullHint}>{t('slotsFullHint')}</p>
      )}

      {inviteOpen && (
        <Modal title={t('invite.title')} onClose={() => setInviteOpen(false)}>
          <Input
            label={t('invite.emailLabel')}
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <Button
            variant="primary"
            size="md"
            fullWidth
            loading={inviting}
            disabled={!inviteEmail.trim()}
            onClick={handleInvite}
          >
            {t('invite.send')}
          </Button>
        </Modal>
      )}

      {removeTarget && !confirmingRemove && (
        <Modal title={t('remove.title')} onClose={() => setRemoveTarget(null)}>
          <p className={styles.confirmText}>
            {t('remove.confirmMessage', { name: removeTarget.profile?.full_name ?? t('unknownAdmin') })}
          </p>
          <Input
            label={t('remove.reasonLabel')}
            value={removeReason}
            onChange={(e) => setRemoveReason(e.target.value)}
          />
          <div className={styles.confirmActions}>
            <Button variant="secondary" size="md" onClick={() => setRemoveTarget(null)}>
              {t('remove.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={!removeReason.trim()}
              onClick={() => setConfirmingRemove(true)}
            >
              {t('remove.confirm')}
            </Button>
          </div>
        </Modal>
      )}

      {removeTarget && confirmingRemove && (
        <MfaChallengeModal
          title={t('remove.mfaTitle')}
          description={t('remove.mfaDescription')}
          onCancel={() => setConfirmingRemove(false)}
          onVerified={runRemove}
        />
      )}

      {removing && <div className={styles.removingOverlay} aria-hidden="true" />}
    </>
  );
}
