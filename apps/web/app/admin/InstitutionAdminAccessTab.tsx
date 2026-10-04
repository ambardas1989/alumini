'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Institution } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeRelativeTime } from '@/lib/format';
import { useDebounce } from '@/lib/useDebounce';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { SheetModal } from '@/components/ui/SheetModal';
import verifyStyles from './VerifyTab.module.css';
import styles from './InstitutionAdminAccessTab.module.css';

type FilterTab = 'pending' | 'approved' | 'rejected' | 'invited';
const TABS: FilterTab[] = ['pending', 'approved', 'rejected', 'invited'];
const MIN_INSTITUTION_QUERY_LENGTH = 2;

/**
 * TASKS_11 TASK 01 — platform-admin review queue for institution-admin
 * ACCESS requests (becoming an admin), distinct from
 * InstitutionRequestsTab (proposing a brand-new institution). Mirrors its
 * card/modal shape, without the MFA re-challenge step InstitutionRequestsTab
 * has — this feature's backend routes (InstitutionAdminController) only
 * require a platform-admin JWT, no MfaChallengeGuard, so re-adding a
 * client-side MFA modal here would imply a security step that isn't
 * actually enforced server-side.
 */
export function InstitutionAdminAccessTab() {
  const t = useTranslations('adminDashboard.institutionAdminAccess');
  const { showToast } = useToast();

  const [tab, setTab] = useState<FilterTab>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<api.InstitutionAdminRequestRow[]>([]);
  const [invites, setInvites] = useState<api.InstitutionAdminInvite[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const debouncedInviteQuery = useDebounce(inviteQuery, 300);
  const [inviteResults, setInviteResults] = useState<Institution[]>([]);
  const [inviteInstitution, setInviteInstitution] = useState<Institution | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async (status: FilterTab) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listInstitutionAdminRequests(status);
      setRequests(data.requests);
      setInvites(data.invites);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  useEffect(() => {
    if (inviteInstitution || debouncedInviteQuery.trim().length < MIN_INSTITUTION_QUERY_LENGTH) {
      setInviteResults([]);
      return;
    }
    let cancelled = false;
    api
      .searchInstitutions(debouncedInviteQuery.trim())
      .then((data) => {
        if (!cancelled) setInviteResults(data.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setInviteResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedInviteQuery, inviteInstitution]);

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      await api.approveInstitutionAdminRequest(id);
      showToast(t('approvedToast'), 'success');
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    setBusyId(rejectTarget);
    try {
      await api.rejectInstitutionAdminRequest(rejectTarget, rejectReason.trim());
      showToast(t('rejectedToast'), 'success');
      setRequests((prev) => prev.filter((r) => r.id !== rejectTarget));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusyId(null);
      setRejectTarget(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteInstitution || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api.platformInviteInstitutionAdmin({ institutionId: inviteInstitution.id, email: inviteEmail.trim() });
      showToast(t('inviteSentToast'), 'success');
      setShowInviteForm(false);
      setInviteInstitution(null);
      setInviteEmail('');
      setInviteQuery('');
      if (tab === 'invited') load('invited');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setInviting(false);
    }
  };

  return (
    <>
      <div className={styles.header}>
        <div className={styles.tabs}>
          {TABS.map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.tabButton} ${tab === f ? styles.tabButtonActive : ''}`}
              onClick={() => setTab(f)}
            >
              {t(`filterTabs.${f}`)}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowInviteForm(true)}>
          {t('inviteButton')}
        </Button>
      </div>

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => load(tab)} fullPage />
      ) : tab === 'invited' ? (
        invites.length === 0 ? (
          <EmptyState icon="✉️" title={t('empty.invitedTitle')} description={t('empty.invitedDescription')} />
        ) : (
          invites.map((invite) => (
            <div key={invite.id} className={verifyStyles.card}>
              <p className={verifyStyles.name}>{invite.email}</p>
              <p className={verifyStyles.meta}>{t('inviteExpires', { time: safeRelativeTime(invite.expires_at) })}</p>
            </div>
          ))
        )
      ) : requests.length === 0 ? (
        <EmptyState icon="🧑‍💼" title={t(`empty.${tab}Title`)} description={t(`empty.${tab}Description`)} />
      ) : (
        requests.map((item) => (
          <div key={item.id} className={verifyStyles.card}>
            <p className={verifyStyles.name}>{item.profile?.full_name ?? t('unknownUser')}</p>
            <p className={verifyStyles.meta}>
              {item.institution?.name ?? ''}
              {item.requested_role ? ` · ${t(`roles.${item.requested_role}`)}` : ''}
            </p>
            {item.requested_message && <p className={verifyStyles.meta}>{item.requested_message}</p>}
            <p className={verifyStyles.submitted}>{t('submitted', { time: safeRelativeTime(item.created_at) })}</p>

            {tab === 'pending' && (
              <div className={verifyStyles.actions}>
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
                <Button variant="primary" size="sm" loading={busyId === item.id} onClick={() => handleApprove(item.id)}>
                  {t('approve')}
                </Button>
              </div>
            )}
          </div>
        ))
      )}

      {rejectTarget && (
        <SheetModal title={t('rejectModal.title')} onClose={() => setRejectTarget(null)}>
          <Textarea label={t('rejectModal.reasonLabel')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} />
          <Button variant="danger" size="md" fullWidth disabled={!rejectReason.trim()} loading={busyId === rejectTarget} onClick={handleReject}>
            {t('rejectModal.submit')}
          </Button>
        </SheetModal>
      )}

      {showInviteForm && (
        <SheetModal title={t('inviteModal.title')} onClose={() => setShowInviteForm(false)}>
          {!inviteInstitution ? (
            <>
              <Input
                label={t('inviteModal.institutionLabel')}
                placeholder={t('inviteModal.institutionPlaceholder')}
                value={inviteQuery}
                onChange={(e) => setInviteQuery(e.target.value)}
                autoFocus
              />
              {inviteResults.length > 0 && (
                <ul className={styles.results}>
                  {inviteResults.map((institution) => (
                    <li key={institution.id}>
                      <button type="button" className={styles.resultRow} onClick={() => setInviteInstitution(institution)}>
                        {institution.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className={styles.selectedCard}>
                <span>{inviteInstitution.name}</span>
                <button type="button" className={styles.changeLink} onClick={() => setInviteInstitution(null)}>
                  {t('inviteModal.changeLink')}
                </button>
              </div>
              <Input
                label={t('inviteModal.emailLabel')}
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <Button variant="primary" size="md" fullWidth disabled={!inviteEmail.trim()} loading={inviting} onClick={handleInvite}>
                {t('inviteModal.submit')}
              </Button>
            </>
          )}
        </SheetModal>
      )}
    </>
  );
}
