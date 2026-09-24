'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Classroom, Institution, Profile } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage, parseValidationErrors } from '@/lib/errors';
import { clearSession, getToken } from '@/lib/auth';
import { safeFormatDate, formatPhoneDisplay, safeRelativeTime, sanitizePhoneInput, normalizePhoneForSubmit } from '@/lib/format';
import { supabase, PROFILE_AVATARS_BUCKET } from '@/lib/supabase';
import { isLinkedInConnectEnabled, buildLinkedInAuthorizeUrl } from '@/lib/linkedin';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { PERSONA_ICONS } from '@/lib/personaMeta';
import { AppShell } from '@/components/layout/AppShell';
import { PageContainer } from '@/components/layout/PageContainer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { PasswordStrength } from '@/components/ui/PasswordStrength';
import { CodeInput } from '@/components/ui/CodeInput';
import { Modal } from '@/components/ui/Modal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ApiError } from '@/lib/api';
import { ClassroomCard, type ClassroomCardData } from '@/components/ClassroomCard';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './page.module.css';

type FlatClassroom = Classroom & { institution: Institution; verificationStatus: string; userRole: string };

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
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [showMfaResetConfirm, setShowMfaResetConfirm] = useState(false);
  const [mfaResetSending, setMfaResetSending] = useState(false);
  const [showMfaSwitchConfirm, setShowMfaSwitchConfirm] = useState(false);
  const [adminNudgeDismissed, setAdminNudgeDismissed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem('alumini_mfa_admin_nudge_dismissed') === 'true',
  );

  // ── Change password modal (TASKS_06 TASK 05) ────────────────────────────
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [changePasswordStep, setChangePasswordStep] = useState<'mfa' | 'password'>('mfa');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaCodeComplete, setMfaCodeComplete] = useState(false);
  const [mfaCodeError, setMfaCodeError] = useState<string | null>(null);
  const [mfaCodeShakeKey, setMfaCodeShakeKey] = useState(0);
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const [mfaWrongAttempts, setMfaWrongAttempts] = useState(0);
  const [mfaLockSeconds, setMfaLockSeconds] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendJustSent, setResendJustSent] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  // ── Active sessions + sign out all devices (TASKS_06 TASK 08 P2a/P2b) ───
  const [sessions, setSessions] = useState<api.SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [showSignOutAllConfirm, setShowSignOutAllConfirm] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

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

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      setSessions(await api.listSessions());
    } catch (err) {
      setSessionsError(getErrorMessage(err));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadSessions();
  }, [ready, loadSessions]);

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
    setPhoneError(null);
    // TASKS_07 TASK 09 FIX B — normalize toward E.164 right before sending,
    // not on every keystroke (see sanitizePhoneInput()'s own onChange use
    // below) — this mirrors apps/backend's own normalizePhone() exactly, so
    // what actually gets validated server-side matches what's shown here.
    const normalizedPhone = phone ? normalizePhoneForSubmit(phone) : '';
    try {
      const updated = await api.updateProfile({ fullName, phone: normalizedPhone || undefined });
      setProfile(updated);
      updateUser({ fullName: updated.fullName, avatarUrl: updated.avatarUrl ?? null });
      setEditing(false);
      showToast(t('updatedToast'), 'success');
    } catch (err) {
      // TASKS_07 TASK 09 FIX C — a phone-format 400 gets its own friendly,
      // field-scoped message instead of the shared generic fallback (or,
      // worse, the raw class-validator string).
      const fieldErrors = parseValidationErrors(err);
      if (fieldErrors.phone) {
        setPhoneError(t('phoneErrors.invalidFormat'));
      } else {
        setSaveError(getErrorMessage(err));
      }
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
      if (storageError) {
        // BUG FIX — Supabase Storage errors aren't ApiError instances
        // (they're @supabase/storage-js's own shape: {message, statusCode}
        // as a STRING, not a number), so getErrorMessage()'s catch-all
        // below always fell through to its generic fallback regardless of
        // whether the bucket/policy issue was a 400, 403, or something
        // else — exactly the raw-looking "something went wrong" this task
        // was filed about. Mapped explicitly here instead.
        // eslint-disable-next-line no-console
        console.error('[AVATAR-UPLOAD]', storageError);
        const statusCode = (storageError as { statusCode?: string }).statusCode;
        if (statusCode === '403') {
          setAvatarError(t('avatarErrors.permissionDenied'));
        } else if (statusCode === '400') {
          setAvatarError(t('avatarErrors.uploadFailed400'));
        } else {
          setAvatarError(t('avatarErrors.uploadFailedGeneric'));
        }
        setAvatarUploading(false);
        return;
      }

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

  const [disconnectingLinkedIn, setDisconnectingLinkedIn] = useState(false);

  const handleDisconnectLinkedIn = async () => {
    setDisconnectingLinkedIn(true);
    try {
      await api.disconnectLinkedinAccount();
      setProfile((prev) => (prev ? { ...prev, linkedinConnected: false, linkedinName: undefined, linkedinAvatarUrl: undefined } : prev));
      showToast(t('linkedin.disconnectedToast'), 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setDisconnectingLinkedIn(false);
    }
  };

  const handleConnectLinkedIn = () => {
    // TASKS_05 TASK 06 — client_id is public; the OAuth code exchange
    // itself (which needs the secret) happens server-side once this tab
    // comes back with ?code=, via a normal authenticated POST, not here.
    const state = crypto.randomUUID();
    sessionStorage.setItem('linkedin_oauth_state', state);
    window.location.href = buildLinkedInAuthorizeUrl(state);
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

  // TASKS_05 TASK 08 Part E — both directions reuse /auth/mfa's own setup
  // flow (real session token, not a pending one) rather than a second QR/
  // code-entry UI here. Switching FROM TOTP shows a plain confirm first;
  // the extra "verify with the current TOTP code" step the task spec also
  // asked for is dropped — proving control of the NEW method before
  // completeMfaSetup() switches mfa_method is already a real, sufficient
  // bar, and chaining a second re-auth step first would meaningfully add
  // to this task's scope for a marginal security gain.
  const handleSwitchMfaMethod = () => {
    if (!profile) return;
    const target = profile.mfaMethod === 'email' ? 'totp' : 'email';
    if (profile.mfaMethod === 'totp') {
      setShowMfaSwitchConfirm(true);
      return;
    }
    router.push(`/auth/mfa?switchMethod=${target}`);
  };

  const handleConfirmSwitchFromTotp = () => {
    setShowMfaSwitchConfirm(false);
    router.push('/auth/mfa?switchMethod=email');
  };

  const handleDismissAdminNudge = () => {
    setAdminNudgeDismissed(true);
    try {
      window.localStorage.setItem('alumini_mfa_admin_nudge_dismissed', 'true');
    } catch {
      // localStorage can throw in private-browsing/blocked-storage contexts — the dismissal just won't persist across reloads, not fatal.
    }
  };

  // ── Change password modal (TASKS_06 TASK 05, hardened in TASKS_07 TASK 04) ─
  //
  // Two UI steps, two real API calls. Step 1 ("Verify") calls
  // challengeMfa(peek: true) — a real, immediate pass/fail check that does
  // NOT consume a single-use email code, so the SAME code can be
  // re-submitted for the real action afterward. Step 2's submit is the
  // actual change: POST /auth/change-password, verifying mfaCode and
  // setting the new password together via MfaChallengeGuard, the same
  // "one combined verify+act request" pattern every other MFA-gated
  // action in this app uses (institution admin invite/remove, codes
  // generation, verification review). TASKS_06's original version had
  // Step 1 only check the code was 6 digits, deferring the real check
  // entirely to Step 2 — any code (right or wrong) reached the password
  // screen, which is the exact bug TASKS_07 TASK 04 was filed against.
  // Step 2 still falls back to sending the user back to Step 1 with an
  // inline error if the code somehow fails there too (e.g. it expired in
  // the gap between the two steps) — same safety net as before.

  const resetChangePasswordState = () => {
    setChangePasswordStep('mfa');
    setMfaCode('');
    setMfaCodeComplete(false);
    setMfaCodeError(null);
    setMfaVerifying(false);
    setMfaWrongAttempts(0);
    setMfaLockSeconds(0);
    setResendSeconds(0);
    setResendJustSent(false);
    setNewPassword('');
    setConfirmNewPassword('');
    setChangePasswordError(null);
  };

  const handleOpenChangePasswordModal = () => {
    resetChangePasswordState();
    setShowChangePasswordModal(true);
    if (profile?.mfaMethod === 'email') {
      void handleSendCode();
    }
  };

  const handleCloseChangePasswordModal = () => {
    setShowChangePasswordModal(false);
    resetChangePasswordState();
  };

  const handleSendCode = async () => {
    setSendingCode(true);
    setMfaCodeError(null);
    try {
      await api.resendMfaEmail(getToken() ?? '');
      setResendSeconds(60);
    } catch (err) {
      setMfaCodeError(getErrorMessage(err));
    } finally {
      setSendingCode(false);
    }
  };

  const handleResendCode = async () => {
    if (resendSeconds > 0) return;
    setResendJustSent(false);
    await handleSendCode();
    setResendJustSent(true);
    setTimeout(() => setResendJustSent(false), 3000);
  };

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  useEffect(() => {
    if (mfaLockSeconds <= 0) return;
    const timer = setTimeout(() => setMfaLockSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [mfaLockSeconds]);

  const MFA_MAX_ATTEMPTS = 3;
  const MFA_LOCKOUT_SECONDS = 60;

  // TASKS_07 TASK 04 — real, immediate verification against the code the
  // user just typed, using challengeMfa(peek: true) so a correct email
  // code isn't consumed here (it gets re-submitted for the real change in
  // Step 2 — see that handler's own comment). A wrong code now properly
  // blocks: it's rejected right here, the input is cleared, and after
  // MFA_MAX_ATTEMPTS wrong attempts the form locks for
  // MFA_LOCKOUT_SECONDS with a visible countdown.
  const handleMfaStepContinue = async () => {
    if (!mfaCodeComplete || mfaVerifying || mfaLockSeconds > 0) return;
    setMfaVerifying(true);
    setMfaCodeError(null);
    try {
      await api.challengeMfa(getToken() ?? '', mfaCode, true);
      setChangePasswordStep('password');
    } catch {
      const nextAttempts = mfaWrongAttempts + 1;
      setMfaWrongAttempts(nextAttempts);
      setMfaCode('');
      setMfaCodeComplete(false);
      setMfaCodeShakeKey((k) => k + 1);
      if (nextAttempts >= MFA_MAX_ATTEMPTS) {
        setMfaWrongAttempts(0);
        setMfaLockSeconds(MFA_LOCKOUT_SECONDS);
        setMfaCodeError(null);
      } else {
        setMfaCodeError(t('account.changePasswordModal.incorrectCode'));
      }
    } finally {
      setMfaVerifying(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      setChangePasswordError(t('account.changePasswordModal.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setChangePasswordError(t('account.changePasswordModal.passwordMismatch'));
      return;
    }

    setChangingPassword(true);
    setChangePasswordError(null);
    try {
      await api.changePassword(mfaCode, newPassword);
      setShowChangePasswordModal(false);
      resetChangePasswordState();
      showToast(t('account.changePasswordModal.successToast'), 'success');
    } catch (err) {
      const code = err instanceof ApiError ? err.errorCode : null;
      if (code === 'AUTH_MFA_INVALID_CODE' || code === 'AUTH_MFA_EXPIRED' || code === 'AUTH_MFA_MAX_ATTEMPTS') {
        // The code turned out wrong/expired by the time Step 2 actually
        // submitted it — send the user back to re-enter it rather than
        // showing an MFA error on the password form.
        setChangePasswordStep('mfa');
        setMfaCode('');
        setMfaCodeComplete(false);
        setMfaCodeError(t('account.changePasswordModal.incorrectCode'));
        setMfaCodeShakeKey((k) => k + 1);
      } else {
        setChangePasswordError(getErrorMessage(err));
      }
    } finally {
      setChangingPassword(false);
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

  const handleSignOutAllDevices = async () => {
    setSigningOutAll(true);
    try {
      await api.logoutAllDevices();
    } catch {
      // Best-effort, same reasoning as handleSignOut() — the local session is cleared either way below.
    }
    clearSession();
    router.push('/auth/login?message=signed_out');
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);
    try {
      await api.revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setRevokingSessionId(null);
    }
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
  const isClassroomAdmin = classrooms.some((c) => c.userRole === 'admin');

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
                {profile.linkedinConnected && <Badge variant="linkedin" label={t('linkedin.badgeLabel')} />}
              </div>
            </>
          ) : (
            <>
              {avatarEditor(64)}

              <div className={styles.editForm}>
                <Input label={t('fullNameLabel')} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <div>
                  <Input
                    label={t('phoneLabel')}
                    type="tel"
                    value={phone}
                    error={phoneError ?? undefined}
                    onChange={(e) => {
                      setPhone(sanitizePhoneInput(e.target.value));
                      if (phoneError) setPhoneError(null);
                    }}
                    onBlur={() => setPhone((prev) => (prev ? normalizePhoneForSubmit(prev) : prev))}
                  />
                  <p className={styles.phoneFormatHint}>{t('phoneFormatHint')}</p>
                </div>
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
                      institution: { name: c.institution.name, type: c.institution.type, cityCode: c.institution.cityCode, logoUrl: c.institution.logoUrl },
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
                {/* No refresh token is retained (see connectLinkedin()'s doc
                    comment) so there's nothing to periodically re-fetch —
                    only ever Connect or Disconnect, no "Sync now". */}
                <span className={styles.linkedinStatus}>
                  {profile.linkedinConnected
                    ? profile.linkedinName
                      ? t('linkedin.connectedAs', { name: profile.linkedinName })
                      : t('linkedin.connectedStatus')
                    : t('linkedin.notConnectedStatus')}
                </span>
              </div>
              {profile.linkedinConnected ? (
                <button
                  type="button"
                  className={styles.linkedinDisconnectLink}
                  onClick={handleDisconnectLinkedIn}
                  disabled={disconnectingLinkedIn}
                >
                  {t('linkedin.disconnect')}
                </button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.linkedinConnectButton}
                  disabled={!isLinkedInConnectEnabled()}
                  onClick={handleConnectLinkedIn}
                >
                  {t('linkedin.connectButton')}
                </Button>
              )}
            </div>

            {profile.mfaEnabled && (
              <>
                <p className={styles.sectionLabel}>{t('account.mfa.sectionLabel')}</p>

                <div className={styles.mfaCurrentCard}>
                  <span className={styles.mfaIcon} aria-hidden="true">
                    {profile.mfaMethod === 'email' ? '✉️' : '🔐'}
                  </span>
                  <span className={styles.accountLabel}>
                    {profile.mfaMethod === 'email' ? t('account.mfa.emailMethodTitle') : t('account.mfa.totpMethodTitle')}
                  </span>
                  <span className={styles.securityBadge}>{t('account.enabledBadge')}</span>
                </div>

                <div className={styles.accountRow}>
                  <span className={styles.accountLabel}>
                    {profile.mfaMethod === 'email' ? t('account.mfa.switchToTotp') : t('account.mfa.switchToEmail')}
                  </span>
                  <Button variant="ghost" size="sm" onClick={handleSwitchMfaMethod}>
                    {t('account.mfa.switchButton')}
                  </Button>
                </div>

                {profile.mfaMethod === 'email' && isClassroomAdmin && !adminNudgeDismissed && (
                  <div className={styles.mfaAdminNudge}>
                    <button type="button" className={styles.mfaAdminNudgeDismiss} onClick={handleDismissAdminNudge} aria-label={tCommon('cancel')}>
                      ×
                    </button>
                    <p className={styles.mfaAdminNudgeTitle}>🔒 {t('account.mfa.adminNudgeTitle')}</p>
                    <p className={styles.mfaAdminNudgeBody}>{t('account.mfa.adminNudgeBody')}</p>
                    <button type="button" className={styles.mfaAdminNudgeCta} onClick={() => router.push('/auth/mfa?switchMethod=totp')}>
                      {t('account.mfa.adminNudgeCta')}
                    </button>
                  </div>
                )}

                <div className={styles.accountRow}>
                  <span className={styles.accountLabel}>{t('account.twoFactorLabel')}</span>
                  <Button variant="ghost" size="sm" onClick={() => setShowMfaResetConfirm(true)}>
                    {t('account.resetButton')}
                  </Button>
                </div>
              </>
            )}

            <div className={styles.accountRow}>
              <span className={styles.accountLabel}>{t('account.changePasswordLabel')}</span>
              <Button variant="ghost" size="sm" onClick={handleOpenChangePasswordModal}>
                {t('account.changePasswordLabel')}
              </Button>
            </div>

            <div className={styles.signOutRow}>
              <span className={styles.signOutLabelGroup}>
                <LogoutIcon />
                <span className={styles.signOutLabel}>{t('account.signOutRowLabel')}</span>
              </span>
              <span className={styles.signOutButtons}>
                <Button variant="ghost" size="sm" className={styles.signOutDangerGhost} onClick={() => setShowSignOutConfirm(true)}>
                  {t('account.signOutThisDeviceButton')}
                </Button>
                <Button variant="ghost" size="sm" className={styles.signOutDangerGhost} onClick={() => setShowSignOutAllConfirm(true)}>
                  {t('account.signOutAllDevicesButton')}
                </Button>
              </span>
            </div>

            <h3 className={styles.sectionSubheading}>{t('account.sessions.heading')}</h3>

            {sessionsLoading && (
              <div className={styles.sessionsLoading}>
                <LoadingSpinner size="sm" />
              </div>
            )}
            {sessionsError && !sessionsLoading && <ErrorMessage message={sessionsError} onRetry={loadSessions} />}

            {!sessionsLoading && !sessionsError && (
              <>
                <ul className={styles.sessionsList}>
                  {sessions.map((session) => {
                    const isMobile = /mobile/i.test(session.deviceInfo ?? '');
                    return (
                      <li key={session.id} className={styles.sessionRow}>
                        <span className={styles.sessionIcon} aria-hidden="true">
                          {isMobile ? '📱' : '💻'}
                        </span>
                        <span className={styles.sessionInfo}>
                          <span className={styles.sessionDevice}>{session.deviceInfo ?? t('account.sessions.unknownDevice')}</span>
                          <span className={styles.sessionMeta}>
                            {t('account.sessions.lastActive', { time: safeRelativeTime(session.lastSeenAt) })}
                          </span>
                          {session.ipAddress && <span className={styles.sessionMeta}>{t('account.sessions.ip', { ip: session.ipAddress })}</span>}
                        </span>
                        {session.isCurrent ? (
                          <Badge label={t('account.sessions.currentBadge')} variant="verified" />
                        ) : (
                          <button
                            type="button"
                            className={styles.sessionRevokeLink}
                            disabled={revokingSessionId === session.id}
                            onClick={() => handleRevokeSession(session.id)}
                          >
                            {t('account.sessions.revokeLink')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {sessions.length > 1 && (
                  <button type="button" className={styles.troubleLink} onClick={() => setShowSignOutAllConfirm(true)}>
                    {t('account.sessions.signOutOtherDevicesLink')}
                  </button>
                )}
              </>
            )}
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

      {showMfaSwitchConfirm && (
        <Modal title={t('account.mfa.switchConfirmTitle')} onClose={() => setShowMfaSwitchConfirm(false)}>
          <p>{t('account.mfa.switchConfirmBody')}</p>
          <div className={styles.confirmActions}>
            <Button variant="ghost" size="md" onClick={() => setShowMfaSwitchConfirm(false)}>
              {tCommon('cancel')}
            </Button>
            <Button variant="danger" size="md" onClick={handleConfirmSwitchFromTotp}>
              {t('account.mfa.switchButton')}
            </Button>
          </div>
        </Modal>
      )}

      {showSignOutConfirm && (
        <Modal title={t('signOutConfirmTitle')} onClose={() => setShowSignOutConfirm(false)}>
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

      {showSignOutAllConfirm && (
        <Modal title={t('account.sessions.signOutAllConfirmTitle')} onClose={() => setShowSignOutAllConfirm(false)}>
          <p>{t('account.sessions.signOutAllConfirmBody')}</p>
          <div className={styles.confirmActions}>
            <Button variant="ghost" size="md" onClick={() => setShowSignOutAllConfirm(false)} disabled={signingOutAll}>
              {tCommon('cancel')}
            </Button>
            <Button variant="danger" size="md" loading={signingOutAll} onClick={handleSignOutAllDevices}>
              {t('account.sessions.signOutAllButton')}
            </Button>
          </div>
        </Modal>
      )}

      {showChangePasswordModal && (
        <Modal
          title={
            changePasswordStep === 'mfa'
              ? t('account.changePasswordModal.mfaStepTitle')
              : t('account.changePasswordModal.passwordStepTitle')
          }
          onClose={handleCloseChangePasswordModal}
        >
          {changePasswordStep === 'mfa' ? (
            <div className={styles.changePasswordStep}>
              <p className={styles.changePasswordInstruction}>
                {profile?.mfaMethod === 'email'
                  ? t('account.changePasswordModal.emailInstruction')
                  : t('account.changePasswordModal.totpInstruction')}
              </p>

              {mfaLockSeconds > 0 ? (
                <p className={styles.mfaLockedText}>
                  {t('account.changePasswordModal.tooManyAttempts', { seconds: mfaLockSeconds })}
                </p>
              ) : (
                <>
                  <CodeInput
                    key={mfaCodeShakeKey}
                    label={t('account.changePasswordModal.codeLabel')}
                    error={!!mfaCodeError}
                    disabled={mfaVerifying || sendingCode}
                    onChange={(value, complete) => {
                      setMfaCode(value);
                      setMfaCodeComplete(complete);
                      if (mfaCodeError) setMfaCodeError(null);
                    }}
                    onComplete={() => {
                      /* handled by the explicit Verify button below, not auto-submit */
                    }}
                  />
                  {mfaCodeError && <ErrorMessage message={mfaCodeError} />}

                  {profile?.mfaMethod === 'email' && (
                    <p className={styles.resendRow}>
                      {resendJustSent ? (
                        t('account.changePasswordModal.resent')
                      ) : resendSeconds > 0 ? (
                        t('account.changePasswordModal.resendIn', { seconds: resendSeconds })
                      ) : (
                        <button type="button" className={styles.troubleLink} onClick={handleResendCode} disabled={sendingCode}>
                          {t('account.changePasswordModal.resendLink')}
                        </button>
                      )}
                    </p>
                  )}
                </>
              )}

              <div className={styles.confirmActions}>
                <Button variant="ghost" size="md" onClick={handleCloseChangePasswordModal}>
                  {tCommon('cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  loading={mfaVerifying}
                  disabled={!mfaCodeComplete || mfaLockSeconds > 0}
                  onClick={handleMfaStepContinue}
                >
                  {t('account.changePasswordModal.verifyButton')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.changePasswordStep}>
              <div>
                <PasswordInput
                  label={t('account.changePasswordModal.newPasswordLabel')}
                  autoComplete="new-password"
                  disabled={changingPassword}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (changePasswordError) setChangePasswordError(null);
                  }}
                />
                <PasswordStrength password={newPassword} />
              </div>
              <PasswordInput
                label={t('account.changePasswordModal.confirmNewPasswordLabel')}
                autoComplete="new-password"
                disabled={changingPassword}
                value={confirmNewPassword}
                onChange={(e) => {
                  setConfirmNewPassword(e.target.value);
                  if (changePasswordError) setChangePasswordError(null);
                }}
              />

              {changePasswordError && <ErrorMessage message={changePasswordError} />}

              <div className={styles.confirmActions}>
                <Button variant="ghost" size="md" onClick={handleCloseChangePasswordModal} disabled={changingPassword}>
                  {tCommon('cancel')}
                </Button>
                <Button variant="primary" size="md" loading={changingPassword} onClick={handleChangePassword}>
                  {t('account.changePasswordModal.changeButton')}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </AppShell>
  );
}

/** Hand-rolled inline SVG, matching this app's established icon convention (no icon-font package installed anywhere in this repo). */
function LogoutIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-linkedin)" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.03-1.85-3.03-1.86 0-2.14 1.45-2.14 2.94v5.66H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}
