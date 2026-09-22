'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { MfaMethod } from '@alumini/types';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import {
  clearMfaPendingSession,
  getMfaPendingSession,
  setMfaPendingSession,
  type MfaPendingSession,
} from '@/lib/mfaSession';
import { getToken } from '@/lib/auth';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/lib/useTranslations';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { CodeInput } from '@/components/ui/CodeInput';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

type Mode = 'setup' | 'verify';

const MAX_ATTEMPTS_REDIRECT_SECONDS = 3;

/**
 * Reads the `email` claim out of the pending JWT's payload — client-side
 * only, no signature check, which is fine here: this only ever feeds a
 * recovery-request call the backend independently looks the account up
 * for by email anyway, never a security decision. Needed because
 * MfaPendingSession (lib/mfaSession.ts) doesn't carry email, only the
 * token and method.
 */
function decodeJwtEmail(token: string): string | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

/** Mirrors AuthService.maskEmail() — te***@yopmail.com. Only used for the user's own address, read from their own pending JWT, so this is a display nicety, not a security boundary. */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  return user.slice(0, 2) + '***@' + domain;
}

const RESEND_COOLDOWN_SECONDS = 60;

export default function MfaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login: establishSession } = useAuth();
  const t = useTranslations('auth.mfa');

  const [pending, setPending] = useState<MfaPendingSession | null | undefined>(undefined);
  // null while the method-selection picker is showing (setup mode only) —
  // once chosen (or immediately, for verify mode, from pending.method),
  // this drives which setup UI (QR vs. "check your email") renders below.
  const [setupMethod, setSetupMethod] = useState<MfaMethod | null>(null);
  const [pickerSelection, setPickerSelection] = useState<MfaMethod>(MfaMethod.EMAIL);
  const [isSwitchMode, setIsSwitchMode] = useState(false);
  const [setupData, setSetupData] = useState<api.SetupMfaResponse | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [showManualKey, setShowManualKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const [resendSeconds, setResendSeconds] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const [resendJustSent, setResendJustSent] = useState(false);

  const [code, setCode] = useState('');
  const [codeComplete, setCodeComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [redirectSeconds, setRedirectSeconds] = useState<number | null>(null);

  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  // True when this navigation arrived from /auth/mfa-recovery's redirect
  // (?recovered=true) — swaps the setup screen's subtitle to explain why
  // the user is back at enrolment instead of it reading like a brand new
  // account. Captured into state, not read from the URL later, since the
  // param gets stripped by router.replace() in the effect below.
  const [recovered, setRecovered] = useState(false);

  // CodeInput's `error` prop needs to flip back to false before it can flip
  // to true again to re-trigger the shake — see its own effect on `error`.
  const [shakeKey, setShakeKey] = useState(0);

  const mode: Mode = pending?.method == null ? 'setup' : 'verify';
  // In verify mode the method is already known (pending.method). In setup
  // mode it's whatever the picker below was told to commit to — null until
  // then, which is what makes the picker show instead of a QR/email section.
  const effectiveMethod: MfaMethod | null = mode === 'verify' ? (pending?.method as MfaMethod | null) : setupMethod;

  // Read the handoff from login()/signup() (sessionStorage) — or, if this
  // navigation just arrived from GET /auth/google/callback's redirect, from
  // the URL's own ?token=&setup= params instead (see auth.controller.ts's
  // googleCallback()). Either way this only runs once per real token: after
  // storing a URL-provided token, router.replace() strips it from the
  // address bar immediately, which re-triggers this effect (searchParams
  // changes) — that second run finds no URL token and falls through to the
  // sessionStorage read, which by then has what the first run just wrote.
  useEffect(() => {
    const urlToken = searchParams.get('token');
    if (urlToken) {
      const isSetup = searchParams.get('setup') !== 'false';
      const urlMethod = searchParams.get('method');
      const method = isSetup ? null : urlMethod === 'totp' || urlMethod === 'sms' || urlMethod === 'email' ? urlMethod : 'totp';
      const session: MfaPendingSession = { token: urlToken, method };
      setMfaPendingSession(session);
      setPending(session);
      if (session.method === 'email') setResendSeconds(RESEND_COOLDOWN_SECONDS);
      if (searchParams.get('recovered') === 'true') setRecovered(true);
      router.replace('/auth/mfa');
      return;
    }

    // TASKS_05 TASK 08 Part E — profile page's "switch method" links here
    // with ?switchMethod=email|totp for an already-logged-in user. Reuses
    // this same setup flow with the real session token (AuthTokenGuard
    // accepts a plain access token, not just a pending one) instead of
    // inventing a second QR/code-entry UI in the profile page.
    const switchMethod = searchParams.get('switchMethod');
    if (switchMethod === 'email' || switchMethod === 'totp') {
      const sessionToken = getToken();
      if (sessionToken) {
        setIsSwitchMode(true);
        setPending({ token: sessionToken, method: null });
        setSetupMethod(switchMethod === 'totp' ? MfaMethod.TOTP : MfaMethod.EMAIL);
        return;
      }
    }

    const session = getMfaPendingSession();
    setPending(session);
    if (session?.method === 'email') setResendSeconds(RESEND_COOLDOWN_SECONDS);
    if (!session) {
      router.replace('/auth/login');
    }
  }, [router, searchParams]);

  useEffect(() => {
    if (!pending || mode !== 'setup' || !setupMethod) return;
    let cancelled = false;
    setSetupLoading(true);
    setSetupError(null);
    api
      .setupMfa(pending.token, setupMethod)
      .then((data) => {
        if (!cancelled) {
          setSetupData(data);
          if (data.method === MfaMethod.EMAIL) setResendSeconds(RESEND_COOLDOWN_SECONDS);
        }
      })
      .catch((err) => {
        if (!cancelled) setSetupError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setSetupLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, mode, setupMethod, setupAttempt]);

  // Resend countdown — shared by setup (email method) and verify (email
  // method) once a code has just been sent; both reset resendSeconds
  // themselves when a fresh code goes out.
  useEffect(() => {
    if (effectiveMethod !== MfaMethod.EMAIL) return;
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [effectiveMethod, resendSeconds]);

  // AUTH_MFA_MAX_ATTEMPTS — "Redirecting in 3... 2... 1..." then bail to login.
  useEffect(() => {
    if (errorCode !== 'AUTH_MFA_MAX_ATTEMPTS') return;
    setRedirectSeconds(MAX_ATTEMPTS_REDIRECT_SECONDS);
  }, [errorCode]);

  useEffect(() => {
    if (redirectSeconds === null) return;
    if (redirectSeconds <= 0) {
      clearMfaPendingSession();
      router.replace('/auth/login');
      return;
    }
    const timer = setTimeout(() => setRedirectSeconds((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [redirectSeconds, router]);

  // AUTH_MFA_EXPIRED — no countdown, just go straight back.
  useEffect(() => {
    if (errorCode !== 'AUTH_MFA_EXPIRED') return;
    clearMfaPendingSession();
    router.replace('/auth/login');
  }, [errorCode, router]);

  const submittingRef = useRef(false);

  const handleSubmit = useCallback(
    async (submittedCode: string) => {
      if (!pending || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setErrorCode(null);
      try {
        const result =
          mode === 'setup'
            ? await api.verifyMfa(pending.token, setupMethod ?? MfaMethod.TOTP, submittedCode)
            : await api.challengeMfa(pending.token, submittedCode);

        establishSession({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt,
          user: result.user,
        });
        clearMfaPendingSession();
        router.push(isSwitchMode ? '/profile' : mode === 'setup' ? '/onboarding' : '/');
      } catch (err) {
        const code = err instanceof ApiError ? err.errorCode : null;
        setErrorCode(code ?? 'AUTH_MFA_INVALID_CODE');
        setShakeKey((k) => k + 1);
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [pending, mode, setupMethod, isSwitchMode, establishSession, router],
  );

  const handleResend = async () => {
    if (!pending || resendSeconds > 0) return;
    setResending(true);
    setResendJustSent(false);
    try {
      await api.resendMfaEmail(pending.token);
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
      setResendJustSent(true);
      setTimeout(() => setResendJustSent(false), 3000);
    } catch (err) {
      setSetupError(getErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  const handleTrouble = () => {
    clearMfaPendingSession();
    router.push('/auth/login');
  };

  const handleLostAccess = async () => {
    if (!pending) return;
    const email = decodeJwtEmail(pending.token);
    if (!email) {
      // No email claim to recover with (shouldn't happen — every pending
      // token this app issues carries one) — send the user back to a
      // path that definitely works instead of failing silently.
      handleTrouble();
      return;
    }
    setRecoverySubmitting(true);
    try {
      await api.requestMfaRecovery(email);
      setRecoverySent(true);
    } catch {
      // requestMfaRecovery() always resolves 200 from the backend's own
      // side (never reveals account existence) — a thrown error here can
      // only be a network/timeout failure. Showing the same "check your
      // inbox" state either way avoids a dead-end retry loop for
      // something the user can't fix by retrying immediately.
      setRecoverySent(true);
    } finally {
      setRecoverySubmitting(false);
    }
  };

  const handleCopySecret = async () => {
    if (!setupData?.secret) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (permissions, insecure context) — the key is
      // still visible on screen to copy manually, so this is non-fatal.
    }
  };

  if (pending === undefined) {
    // Reading sessionStorage — effectively instant, but avoids a one-frame
    // flash of the wrong mode before the mount effect above resolves it.
    return (
      <AuthLayout tagline={t('tagline')} subTagline={t('subTagline')}>
        {null}
      </AuthLayout>
    );
  }
  if (pending === null) {
    return null; // redirecting to /auth/login
  }

  const isShaking = errorCode === 'AUTH_MFA_INVALID_CODE';
  const showRedirectNotice = errorCode === 'AUTH_MFA_MAX_ATTEMPTS' || errorCode === 'AUTH_MFA_EXPIRED';
  const verifyEmailMasked = mode === 'verify' && pending.method === 'email' ? (() => {
    const e = decodeJwtEmail(pending.token);
    return e ? maskEmail(e) : '';
  })() : '';

  return (
    <AuthLayout tagline={t('tagline')} subTagline={t('subTagline')}>
      <div className={styles.top}>
        <h1 className={styles.title}>
          {mode === 'setup' && !setupMethod ? t('picker.heading') : mode === 'setup' ? t('setupTitle') : t('verifyTitle')}
        </h1>
        {(mode !== 'setup' || setupMethod) && (
          <p className={styles.subtitle}>
            {mode === 'setup'
              ? recovered
                ? t('recovery.setupAgainBanner')
                : t('setupSubtitle')
              : pending.method === 'email'
                ? t('email.verifySubtitle')
                : t('verifySubtitle')}
          </p>
        )}
      </div>

      {mode === 'setup' && !setupMethod && (
        <div className={styles.pickerSection}>
          <button
            type="button"
            className={`${styles.pickerCard} ${pickerSelection === MfaMethod.EMAIL ? styles.pickerCardSelected : ''}`}
            onClick={() => setPickerSelection(MfaMethod.EMAIL)}
          >
            <span className={styles.pickerIcon} aria-hidden="true">
              ✉️
            </span>
            <span className={styles.pickerTitle}>{t('picker.email.title')}</span>
            <span className={styles.pickerDescription}>{t('picker.email.description')}</span>
            <span className={styles.pickerPillGreen}>{t('picker.email.recommended')}</span>
          </button>

          <button
            type="button"
            className={`${styles.pickerCard} ${pickerSelection === MfaMethod.TOTP ? styles.pickerCardSelected : ''}`}
            onClick={() => setPickerSelection(MfaMethod.TOTP)}
          >
            <span className={styles.pickerIcon} aria-hidden="true">
              🔐
            </span>
            <span className={styles.pickerTitle}>{t('picker.totp.title')}</span>
            <span className={styles.pickerDescription}>{t('picker.totp.description')}</span>
            <span className={styles.pickerPillBlue}>{t('picker.totp.moreSecure')}</span>
          </button>

          <Button variant="primary" size="lg" fullWidth onClick={() => setSetupMethod(pickerSelection)} className="auth-primary-button">
            {t('picker.continueButton')}
          </Button>
        </div>
      )}

      {mode === 'setup' && setupMethod === MfaMethod.EMAIL && setupData && !setupLoading && !setupError && (
        <div className={styles.emailSection}>
          <span className={styles.emailIcon} aria-hidden="true">
            ✉️
          </span>
          <p className={styles.emailHeading}>{t('email.checkTitle')}</p>
          <p className={styles.emailSubtext}>{t('email.sentTo', { email: setupData.destination ?? '' })}</p>
        </div>
      )}

      {mode === 'verify' && pending.method === 'email' && (
        <div className={styles.emailSection}>
          <span className={styles.emailIcon} aria-hidden="true">
            ✉️
          </span>
          <p className={styles.emailHeading}>{t('email.checkTitle')}</p>
          <p className={styles.emailSubtext}>{t('email.sentTo', { email: verifyEmailMasked })}</p>
        </div>
      )}

      {mode === 'setup' && effectiveMethod === MfaMethod.TOTP && (
        <div className={styles.qrSection}>
          {setupLoading && (
            <div className={styles.qrSkeleton}>
              <LoadingSpinner size="lg" />
            </div>
          )}
          {setupError && !setupLoading && (
            <ErrorMessage message={setupError} onRetry={() => setSetupAttempt((n) => n + 1)} />
          )}
          {setupData?.qrCodeUrl && !setupLoading && !setupError && (
            <>
              <p className={styles.scanInstruction}>{t('scanQrInstruction')}</p>
              {/* unoptimized: this is a per-user, server-generated data: URI,
                  not a static asset or remote URL — Next's image optimizer
                  has nothing to fetch/transform, so it's opted out rather
                  than left to fail against a data URI. */}
              <Image
                src={setupData.qrCodeUrl}
                alt={t('scanQrInstruction')}
                width={200}
                height={200}
                unoptimized
                className={styles.qrImage}
              />

              <button type="button" className={styles.manualKeyToggle} onClick={() => setShowManualKey((v) => !v)}>
                {t('manualKey')}
              </button>
              {showManualKey && (
                <div className={styles.manualKeyBox}>
                  <code className={styles.secret}>{setupData.secret}</code>
                  <button type="button" className={styles.copyButton} onClick={handleCopySecret}>
                    {copied ? t('secretCopied') : t('copySecret')}
                  </button>
                </div>
              )}

              <p className={styles.appSuggestion}>{t('appSuggestion')}</p>
              <div className={styles.appIcons}>
                <span className={styles.appIcon}>Google Authenticator</span>
                <span className={styles.appIcon}>Authy</span>
                <span className={styles.appIcon}>Any TOTP app</span>
              </div>
            </>
          )}
        </div>
      )}

      {!showRedirectNotice && effectiveMethod && (mode === 'verify' || (setupData && !setupLoading && !setupError)) && (
        <div className={styles.codeSection}>
          {/* TOTP has no resend — codes are generated by the authenticator
              app itself, not sent by this app. Email does, right below. */}
          {effectiveMethod !== MfaMethod.EMAIL && (
            <p className={styles.codeInstruction}>
              {mode === 'setup' ? t('confirmSetupInstruction') : t('codeHelperText')}
            </p>
          )}
          <CodeInput
            key={shakeKey}
            label={t('codeLabel')}
            error={isShaking}
            disabled={submitting}
            onChange={(value, complete) => {
              setCode(value);
              setCodeComplete(complete);
              if (errorCode === 'AUTH_MFA_INVALID_CODE') setErrorCode(null);
            }}
            onComplete={handleSubmit}
          />
          {isShaking && <ErrorMessage message={t('errors.invalidCode')} />}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!codeComplete}
            onClick={() => handleSubmit(code)}
            className="auth-primary-button"
          >
            {t('submitButton')}
          </Button>

          {effectiveMethod === MfaMethod.EMAIL && (
            <p className={styles.resendRow}>
              {resendJustSent ? (
                t('email.resent')
              ) : resendSeconds > 0 ? (
                t('email.resendIn', { seconds: resendSeconds })
              ) : (
                <button type="button" className={styles.troubleLink} onClick={handleResend} disabled={resending}>
                  {t('email.resendLink')}
                </button>
              )}
            </p>
          )}

          {mode === 'verify' && (
            <>
              {recoverySent ? (
                <p className={styles.recoverySent}>{t('recovery.sent')}</p>
              ) : (
                <button
                  type="button"
                  className={styles.troubleLink}
                  onClick={handleLostAccess}
                  disabled={recoverySubmitting}
                >
                  {recoverySubmitting ? t('recovery.sending') : t('recovery.link')}
                </button>
              )}

              <button type="button" className={styles.troubleLink} onClick={handleTrouble}>
                {t('troubleLink')}
              </button>
            </>
          )}
        </div>
      )}

      {showRedirectNotice && (
        <div className={styles.redirectNotice}>
          <ErrorMessage
            message={
              errorCode === 'AUTH_MFA_MAX_ATTEMPTS' ? t('errors.maxAttemptsRedirect') : t('errors.expiredCode')
            }
          />
          {redirectSeconds !== null && (
            <p className={styles.countdown}>{t('redirectingIn', { seconds: redirectSeconds })}</p>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
