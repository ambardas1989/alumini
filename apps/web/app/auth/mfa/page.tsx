'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { clearMfaPendingSession, getMfaPendingSession, type MfaPendingSession } from '@/lib/mfaSession';
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

export default function MfaPage() {
  const router = useRouter();
  const { login: establishSession } = useAuth();
  const t = useTranslations('auth.mfa');

  const [pending, setPending] = useState<MfaPendingSession | null | undefined>(undefined);
  const [setupData, setSetupData] = useState<{ qrCodeUrl: string; secret: string } | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [showManualKey, setShowManualKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const [code, setCode] = useState('');
  const [codeComplete, setCodeComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [redirectSeconds, setRedirectSeconds] = useState<number | null>(null);

  // CodeInput's `error` prop needs to flip back to false before it can flip
  // to true again to re-trigger the shake — see its own effect on `error`.
  const [shakeKey, setShakeKey] = useState(0);

  const mode: Mode = pending?.method == null ? 'setup' : 'verify';

  // Read the handoff from login()/signup() once, on mount — see lib/mfaSession.ts.
  useEffect(() => {
    const session = getMfaPendingSession();
    setPending(session);
    if (!session) {
      router.replace('/auth/login');
    }
  }, [router]);

  useEffect(() => {
    if (!pending || mode !== 'setup') return;
    let cancelled = false;
    setSetupLoading(true);
    setSetupError(null);
    api
      .setupMfa(pending.token)
      .then((data) => {
        if (!cancelled) setSetupData(data);
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
  }, [pending, mode, setupAttempt]);

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
            ? await api.verifyMfa(pending.token, submittedCode)
            : await api.challengeMfa(pending.token, submittedCode);

        establishSession({ accessToken: result.accessToken, expiresAt: result.expiresAt, user: result.user });
        clearMfaPendingSession();
        router.push(mode === 'setup' ? '/onboarding' : '/');
      } catch (err) {
        const code = err instanceof ApiError ? err.errorCode : null;
        setErrorCode(code ?? 'AUTH_MFA_INVALID_CODE');
        setShakeKey((k) => k + 1);
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [pending, mode, establishSession, router],
  );

  const handleTrouble = () => {
    clearMfaPendingSession();
    router.push('/auth/login');
  };

  const handleCopySecret = async () => {
    if (!setupData) return;
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

  return (
    <AuthLayout tagline={t('tagline')} subTagline={t('subTagline')}>
      <div className={styles.top}>
        <h1 className={styles.title}>{mode === 'setup' ? t('setupTitle') : t('verifyTitle')}</h1>
        <p className={styles.subtitle}>{mode === 'setup' ? t('setupSubtitle') : t('verifySubtitle')}</p>
      </div>

      {mode === 'setup' && (
        <div className={styles.qrSection}>
          {setupLoading && (
            <div className={styles.qrSkeleton}>
              <LoadingSpinner size="lg" />
            </div>
          )}
          {setupError && !setupLoading && (
            <ErrorMessage message={setupError} onRetry={() => setSetupAttempt((n) => n + 1)} />
          )}
          {setupData && !setupLoading && !setupError && (
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

      {!showRedirectNotice && (
        <div className={styles.codeSection}>
          {mode === 'setup' && <p className={styles.codeInstruction}>{t('confirmSetupInstruction')}</p>}
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

          {mode === 'setup' && (
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
          )}

          {mode === 'verify' && (
            <button type="button" className={styles.troubleLink} onClick={handleTrouble}>
              {t('troubleLink')}
            </button>
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
