'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Classroom, Institution, Profile } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { clearSession } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { PERSONA_ICONS } from '@/lib/personaMeta';
import { brand } from '@/lib/brand';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { LinkedInButton } from '@/components/ui/LinkedInButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ClassroomCard, type ClassroomCardData } from '@/components/ClassroomCard';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './page.module.css';

type FlatClassroom = Classroom & { institution: Institution; verificationStatus: string };

export default function ProfilePage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const tTypes = useTranslations('personaTypes');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [classrooms, setClassrooms] = useState<FlatClassroom[]>([]);

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [showMfaResetConfirm, setShowMfaResetConfirm] = useState(false);
  const [mfaResetSending, setMfaResetSending] = useState(false);

  const [passwordResetSending, setPasswordResetSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [profileData, myClassrooms] = await Promise.all([api.getProfile(), api.getMyClassrooms()]);
      setProfile(profileData);
      setClassrooms(
        myClassrooms.flatMap((g) =>
          g.classes.map((c) => ({ ...c, institution: g.institution }) as FlatClassroom),
        ),
      );
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const startEditing = () => {
    if (!profile) return;
    setFullName(profile.fullName ?? '');
    setPhone(profile.phone ?? '');
    setSaveError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.updateProfile({ fullName, phone: phone || undefined });
      setProfile(updated);
      updateUser({ fullName: updated.fullName, avatarUrl: updated.avatarUrl ?? null });
      setEditing(false);
      showToast(t('updatedToast'), 'success');
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarTap = () => {
    showToast(t('photoComingSoonToast'), 'info');
  };

  const handleDisconnectLinkedIn = () => {
    showToast(t('linkedin.comingSoonToast'), 'info');
  };

  const handleConnectLinkedIn = () => {
    showToast(t('linkedin.comingSoonToast'), 'info');
  };

  const handleMfaReset = async () => {
    if (!profile) return;
    setMfaResetSending(true);
    try {
      await api.requestMfaRecovery(profile.email);
      showToast(t('account.resetSentToast'), 'success');
    } catch {
      // requestMfaRecovery() always resolves 200 from the backend's own privacy-preserving design — this is unreachable in practice.
    } finally {
      setMfaResetSending(false);
      setShowMfaResetConfirm(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!profile) return;
    setPasswordResetSending(true);
    try {
      await api.forgotPassword(profile.email);
      showToast(t('account.resetLinkSentToast'), 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setPasswordResetSending(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await api.logout();
    } catch {
      // Best-effort — the local session is cleared either way below (same as AuthProvider.logout()).
    }
    clearSession();
    router.push('/auth/login?message=signed_out');
  };

  if (!ready) return null;

  if (loading) {
    return (
      <AppShell>
        <div className={styles.centeredLoading}>
          <LoadingSpinner size="lg" />
        </div>
      </AppShell>
    );
  }

  if (loadError || !profile) {
    return (
      <AppShell>
        <ErrorMessage message={loadError ?? tCommon('error')} fullPage onRetry={load} />
      </AppShell>
    );
  }

  const verifiedCount = classrooms.filter((c) => c.verificationStatus === 'verified').length;

  // FIX 2 — belt-and-suspenders: the actual root cause was
  // identity.service.ts's getProfile()/updateProfile() returning
  // snake_case field names (full_name, created_at, ...) while every field
  // here reads camelCase, so profile.createdAt was `undefined` and
  // formatDate(undefined, ...) -> new Date(undefined) -> Invalid Date ->
  // Intl.DateTimeFormat.format() throwing RangeError, which is what
  // actually crashed the render (now fixed at the source with alias:column
  // selects). These fallbacks are cheap insurance against the same crash
  // shape if any field is ever legitimately absent (e.g. a genuinely new
  // account with no avatar/phone/linkedin set).
  const safeFullName = profile.fullName ?? 'Unknown';
  const safeEmail = profile.email ?? '';
  const safeCreatedAt = profile.createdAt ?? new Date().toISOString();
  const memberSinceLabel = formatDate(safeCreatedAt, undefined, { month: 'short', year: 'numeric' });

  return (
    <AppShell>
      <PageContainer>
        <div className={styles.header}>
          {!editing && (
            <button type="button" className={styles.editButton} onClick={startEditing}>
              {t('editButton')}
            </button>
          )}

          {!editing ? (
            <>
              <Avatar avatarUrl={profile.avatarUrl ?? null} fullName={safeFullName} size="xl" />
              <p className={styles.name}>{safeFullName}</p>
              <p className={styles.email}>{safeEmail}</p>
              <p className={styles.memberSince}>{t('memberSince', { date: memberSinceLabel })}</p>
            </>
          ) : (
            <>
              <button type="button" className={styles.avatarEditWrap} onClick={handleAvatarTap}>
                <Avatar avatarUrl={profile.avatarUrl ?? null} fullName={safeFullName} size="xl" />
                <span className={styles.avatarOverlay} aria-hidden="true">
                  📷
                </span>
              </button>

              <div className={styles.editForm}>
                <Input label={t('fullNameLabel')} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <Input
                  label={t('phoneLabel')}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {saveError && <ErrorMessage message={saveError} />}
                <div className={styles.editActions}>
                  <Button variant="ghost" size="md" onClick={() => setEditing(false)} disabled={saving}>
                    {tCommon('cancel')}
                  </Button>
                  <Button variant="primary" size="md" loading={saving} onClick={handleSave}>
                    {tCommon('save')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {!editing && (
          <div className={styles.statsRow}>
            <div className={styles.statItem}>
              <p className={styles.statNumber}>{classrooms.length}</p>
              <p className={styles.statLabel}>{t('stats.classrooms')}</p>
            </div>
            <div className={styles.statItem}>
              <p className={styles.statNumber}>{verifiedCount}</p>
              <p className={styles.statLabel}>{t('stats.verifiedIn')}</p>
            </div>
            <div className={styles.statItem}>
              <p className={styles.statNumber}>{memberSinceLabel}</p>
              <p className={styles.statLabel}>{t('stats.memberSince')}</p>
            </div>
          </div>
        )}

        {!editing && (
          <>
            <p className={styles.sectionLabel}>{t('yourClassrooms')}</p>
            {classrooms.length === 0 ? (
              <EmptyState
                icon="🎓"
                title={t('noClassroomsTitle')}
                description={t('noClassroomsDescription')}
                ctaLabel={t('findMyBatch')}
                onCta={() => router.push('/classes')}
              />
            ) : (
              classrooms.map((c) => (
                <ClassroomCard
                  key={c.id}
                  classroom={
                    {
                      globalId: c.globalId,
                      name: c.name,
                      batchYear: c.batchYear,
                      memberCount: c.memberCount,
                      institution: { name: c.institution.name },
                      verificationStatus: c.verificationStatus as ClassroomCardData['verificationStatus'],
                    } satisfies ClassroomCardData
                  }
                />
              ))
            )}

            <Link href="/persona" className={styles.personaRow}>
              <span className={styles.personaIcon} aria-hidden="true">
                {PERSONA_ICONS[profile.activePersona]}
              </span>
              <span className={styles.personaLabel}>{t('switchPersona')}</span>
              <span className={styles.personaBadge}>{tTypes(profile.activePersona)}</span>
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>

            <div className={styles.linkedinSection}>
              {profile.linkedinVerified && profile.linkedinUrl ? (
                <>
                  <div className={styles.linkedinRow}>
                    <span className={styles.linkedinUrl}>{profile.linkedinUrl}</span>
                    <span className={styles.verifiedBadge}>{t('linkedin.verifiedBadge')}</span>
                  </div>
                  <button type="button" className={styles.disconnectLink} onClick={handleDisconnectLinkedIn}>
                    {t('linkedin.disconnect')}
                  </button>
                </>
              ) : (
                <>
                  <LinkedInButton onClick={handleConnectLinkedIn}>{t('linkedin.connectButton')}</LinkedInButton>
                  <p className={styles.linkedinNote}>{t('linkedin.usageNote')}</p>
                </>
              )}
            </div>

            <p className={styles.sectionLabel}>{t('account.sectionLabel')}</p>

            {profile.mfaEnabled && (
              <div className={styles.accountRow}>
                <span className={styles.accountLabel}>{t('account.twoFactorLabel')}</span>
                <span className={styles.securityBadge}>{t('account.enabledBadge')}</span>
                <Button variant="ghost" size="sm" onClick={() => setShowMfaResetConfirm(true)}>
                  {t('account.resetButton')}
                </Button>
              </div>
            )}

            <div className={styles.accountRow}>
              <span className={styles.accountLabel}>{t('account.changePasswordLabel')}</span>
              <Button variant="ghost" size="sm" loading={passwordResetSending} onClick={handlePasswordReset}>
                {t('account.sendResetLinkButton')}
              </Button>
            </div>

            <div className={styles.accountRow}>
              <span className={styles.accountLabel}>{t('account.signOutLabel')}</span>
              <Button variant="danger" size="sm" onClick={() => setShowSignOutConfirm(true)}>
                {t('account.signOutButton')}
              </Button>
            </div>
          </>
        )}
      </PageContainer>

      {showMfaResetConfirm && (
        <Modal title={t('account.resetConfirmTitle')} onClose={() => setShowMfaResetConfirm(false)}>
          <p>{t('account.resetConfirmBody')}</p>
          <div className={styles.confirmActions}>
            <Button variant="ghost" size="md" onClick={() => setShowMfaResetConfirm(false)} disabled={mfaResetSending}>
              {tCommon('cancel')}
            </Button>
            <Button variant="danger" size="md" loading={mfaResetSending} onClick={handleMfaReset}>
              {t('account.resetButton')}
            </Button>
          </div>
        </Modal>
      )}

      {showSignOutConfirm && (
        <Modal title={t('signOutConfirmTitle', { brand: brand.name })} onClose={() => setShowSignOutConfirm(false)}>
          <div className={styles.confirmActions}>
            <Button variant="ghost" size="md" onClick={() => setShowSignOutConfirm(false)} disabled={signingOut}>
              {tCommon('cancel')}
            </Button>
            <Button variant="danger" size="md" loading={signingOut} onClick={handleSignOut}>
              {t('signOut')}
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
