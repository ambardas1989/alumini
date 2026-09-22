'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Classroom, Institution, Profile } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { clearSession } from '@/lib/auth';
import { safeFormatDate, formatPhoneDisplay } from '@/lib/format';
import { supabase, PROFILE_AVATARS_BUCKET } from '@/lib/supabase';
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

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

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

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

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

  const ACCEPTED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

  const handleAvatarClick = () => {
    if (avatarUploading) return;
    avatarInputRef.current?.click();
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = ''; // lets the same file be re-picked later (e.g. after Cancel)
    if (!chosen) return;

    if (!ACCEPTED_AVATAR_TYPES.includes(chosen.type)) {
      setAvatarError(t('avatarErrors.wrongType'));
      return;
    }
    if (chosen.size > MAX_AVATAR_SIZE_BYTES) {
      setAvatarError(t('avatarErrors.tooLarge'));
      return;
    }

    setAvatarError(null);
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    setAvatarFile(chosen);
    setAvatarPreviewUrl(URL.createObjectURL(chosen));
  };

  const handleAvatarCancel = () => {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    setAvatarError(null);
  };

  const handleAvatarSave = async () => {
    if (!avatarFile || !profile) return;
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const ext = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `profiles/${profile.id}/avatar.${ext}`;
      const { error: storageError } = await supabase.storage
        .from(PROFILE_AVATARS_BUCKET)
        .upload(path, avatarFile, { upsert: true });
      if (storageError) throw storageError;

      const { data: publicUrlData } = supabase.storage.from(PROFILE_AVATARS_BUCKET).getPublicUrl(path);
      // Cache-bust — same path as any previous upload, so without this the
      // browser/CDN may keep showing the old photo after a re-upload.
      const publicUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

      const updated = await api.updateProfile({ avatarUrl: publicUrl });
      setProfile(updated);
      updateUser({ avatarUrl: updated.avatarUrl ?? null });
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      showToast(t('avatarUpdatedToast'), 'success');
    } catch (err) {
      setAvatarError(getErrorMessage(err));
    } finally {
      setAvatarUploading(false);
    }
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
  // selects, and belt-and-suspenders here with safeFormatDate(), which
  // never throws regardless of what it's given).
  const safeFullName = profile.fullName ?? 'Unknown';
  const safeEmail = profile.email ?? '';
  const memberSinceLabel = safeFormatDate(profile.createdAt, { month: 'short', year: 'numeric' });
  const phoneDisplay = profile.phone ? formatPhoneDisplay(profile.phone) : null;

  // Shared between the editing/non-editing header layouts — avatar upload
  // works from either state, not just while the name/phone form is open.
  const avatarEditor = (sizePx: number) => (
    <>
      <button type="button" className={styles.avatarEditWrap} onClick={handleAvatarClick} disabled={avatarUploading}>
        <Avatar avatarUrl={avatarPreviewUrl ?? profile.avatarUrl ?? null} fullName={safeFullName} sizePx={sizePx} />
        {avatarUploading ? (
          <span className={styles.avatarSpinnerOverlay} aria-hidden="true">
            <LoadingSpinner size="sm" />
          </span>
        ) : (
          <span className={styles.avatarOverlay} aria-hidden="true">
            📷
          </span>
        )}
      </button>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className={styles.hiddenInput}
        onChange={handleAvatarFileChange}
      />
      {avatarError && <p className={styles.avatarErrorText}>{avatarError}</p>}
      {avatarPreviewUrl && !avatarUploading && (
        <div className={styles.avatarSaveRow}>
          <Button variant="ghost" size="sm" onClick={handleAvatarCancel}>
            {tCommon('cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleAvatarSave}>
            {tCommon('save')}
          </Button>
        </div>
      )}
    </>
  );

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
              {avatarEditor(56)}
              <p className={styles.name}>{safeFullName}</p>
              {/* Profile has no location field and isn't tied to a single
                  classroom's batch year (a user can belong to several), so
                  the mockup's "location + batch" line is replaced with the
                  real data this app actually has for a person: their email
                  and join date. */}
              <p className={styles.email}>{safeEmail}</p>
              {phoneDisplay && <p className={styles.memberSince}>{phoneDisplay}</p>}
              <p className={styles.memberSince}>{t('memberSince', { date: memberSinceLabel })}</p>
              <div className={styles.badgeRow}>
                <span className={styles.personaTypeBadge}>{tTypes(profile.activePersona)}</span>
                {verifiedCount > 0 && <span className={styles.verifiedHeaderBadge}>{t('verifiedBadge')}</span>}
              </div>
            </>
          ) : (
            <>
              {avatarEditor(64)}

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

        {/* Spec asks for "Connections | Profile %" as the last two columns —
            neither concept exists in this app's data model (no connections
            graph, no profile-completeness endpoint), so the 3rd column
            stays the real "verified since" metric rather than a fabricated
            number. */}
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
                      institution: { name: c.institution.name, type: c.institution.type, cityCode: c.institution.cityCode },
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

            <p className={styles.sectionLabel}>{t('account.sectionLabel')}</p>

            <div className={styles.accountRow}>
              <LinkedInIcon />
              <div className={styles.linkedinRowText}>
                <span className={styles.accountLabel}>{t('linkedin.title')}</span>
                {/* No sync timestamp exists in the data model yet (that's
                    TASK 06's linkedin_synced_at column) — a "Sync now"
                    action here would have nothing to do, so this only ever
                    shows Connect or Disconnect. */}
                <span className={styles.linkedinStatus}>
                  {profile.linkedinVerified && profile.linkedinUrl
                    ? t('linkedin.connectedStatus')
                    : t('linkedin.notConnectedStatus')}
                </span>
              </div>
              {profile.linkedinVerified && profile.linkedinUrl ? (
                <button type="button" className={styles.linkedinDisconnectLink} onClick={handleDisconnectLinkedIn}>
                  {t('linkedin.disconnect')}
                </button>
              ) : (
                <Button variant="ghost" size="sm" className={styles.linkedinConnectButton} onClick={handleConnectLinkedIn}>
                  {t('linkedin.connectButton')}
                </Button>
              )}
            </div>

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

function LinkedInIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-linkedin)" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.03-1.85-3.03-1.86 0-2.14 1.45-2.14 2.94v5.66H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}
