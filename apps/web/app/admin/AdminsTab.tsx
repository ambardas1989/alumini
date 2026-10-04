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
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { MfaChallengeModal } from '@/components/MfaChallengeModal';
import styles from './AdminsTab.module.css';
import tabStyles from './Tab.module.css';
import { safeRelativeTime } from '@/lib/format';

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

  // TASKS_11 TASK 05 — classroom-level admins (membership.role='admin'),
  // distinct from the institution-level roster above.
  const [classroomAdmins, setClassroomAdmins] = useState<api.ClassroomAdminRow[]>([]);
  const [demoting, setDemoting] = useState<string | null>(null);

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteClassrooms, setPromoteClassrooms] = useState<api.AdminClassroomEntry[]>([]);
  const [promoteClassroomId, setPromoteClassroomId] = useState('');
  const [promoteMembers, setPromoteMembers] = useState<api.ClassroomMember[]>([]);
  const [promoteUserId, setPromoteUserId] = useState('');
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, classroomAdminRows] = await Promise.all([
        api.getAdmins(institutionId),
        api.getClassroomAdmins(institutionId),
      ]);
      setAdmins(data.admins);
      setPendingInvites(data.pendingInvites);
      setClassroomAdmins(classroomAdminRows);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenPromote = async () => {
    setPromoteOpen(true);
    setPromoteClassroomId('');
    setPromoteUserId('');
    setPromoteMembers([]);
    try {
      const yearGroups = await api.getClassrooms(institutionId);
      setPromoteClassrooms(yearGroups.flatMap((g) => g.classrooms));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const handleSelectPromoteClassroom = async (classroomId: string) => {
    setPromoteClassroomId(classroomId);
    setPromoteUserId('');
    if (!classroomId) {
      setPromoteMembers([]);
      return;
    }
    try {
      const members = await api.getMembers(classroomId);
      setPromoteMembers(members.filter((m) => m.role !== 'admin'));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const handlePromote = async () => {
    if (!promoteClassroomId || !promoteUserId) return;
    setPromoting(true);
    try {
      await api.setClassroomAdminRole(institutionId, promoteUserId, promoteClassroomId, 'promote');
      showToast(t('classroomAdmins.promotedToast'), 'success');
      setPromoteOpen(false);
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setPromoting(false);
    }
  };

  const handleDemote = async (row: api.ClassroomAdminRow) => {
    setDemoting(`${row.userId}:${row.classroomId}`);
    try {
      await api.setClassroomAdminRole(institutionId, row.userId, row.classroomId, 'demote');
      showToast(t('classroomAdmins.demotedToast'), 'success');
      setClassroomAdmins((prev) => prev.filter((a) => !(a.userId === row.userId && a.classroomId === row.classroomId)));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setDemoting(null);
    }
  };

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
            <span className={styles.rowMeta}>
              {admin.profile?.email ? `${admin.profile.email} · ` : ''}
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

      {/* TASKS_11 TASK 05 — classroom-level admins, distinct from the institution-level roster above. */}
      <div className={tabStyles.sectionHeader}>
        <span className={tabStyles.sectionLabel}>{t('classroomAdmins.title')}</span>
      </div>
      {classroomAdmins.length === 0 ? (
        <p className={styles.slotLabel}>{t('classroomAdmins.empty')}</p>
      ) : (
        classroomAdmins.map((row) => {
          const key = `${row.userId}:${row.classroomId}`;
          return (
            <div key={key} className={styles.row}>
              <Avatar avatarUrl={row.profile?.avatar_url} fullName={row.profile?.full_name ?? t('unknownAdmin')} size="md" />
              <span className={styles.rowText}>
                <span className={styles.rowName}>{row.profile?.full_name ?? t('unknownAdmin')}</span>
                <span className={styles.rowMeta}>
                  {row.classroom?.name ?? row.classroomId} · {t('classroomAdmins.since', { time: safeRelativeTime(row.since) })}
                </span>
              </span>
              <Button variant="secondary" size="sm" loading={demoting === key} onClick={() => handleDemote(row)}>
                {t('classroomAdmins.demoteAction')}
              </Button>
            </div>
          );
        })
      )}
      <Button variant="secondary" size="md" fullWidth onClick={handleOpenPromote}>
        {t('classroomAdmins.promoteCta')}
      </Button>

      {promoteOpen && (
        <Modal title={t('classroomAdmins.promoteModal.title')} onClose={() => setPromoteOpen(false)}>
          <Select
            label={t('classroomAdmins.promoteModal.classroomLabel')}
            value={promoteClassroomId}
            onChange={(e) => handleSelectPromoteClassroom(e.target.value)}
          >
            <option value="">{t('classroomAdmins.promoteModal.classroomPlaceholder')}</option>
            {promoteClassrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>

          {promoteClassroomId && (
            <Select
              label={t('classroomAdmins.promoteModal.memberLabel')}
              value={promoteUserId}
              onChange={(e) => setPromoteUserId(e.target.value)}
            >
              <option value="">{t('classroomAdmins.promoteModal.memberPlaceholder')}</option>
              {promoteMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName ?? t('unknownAdmin')}
                </option>
              ))}
            </Select>
          )}

          <Button
            variant="primary"
            size="md"
            fullWidth
            loading={promoting}
            disabled={!promoteClassroomId || !promoteUserId}
            onClick={handlePromote}
          >
            {t('classroomAdmins.promoteModal.confirm')}
          </Button>
        </Modal>
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
