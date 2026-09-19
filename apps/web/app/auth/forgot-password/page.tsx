'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { AuthStatusIcon } from '@/components/ui/AuthStatusIcon';
import styles from './page.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;

type Step = 'request' | 'success';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgotPassword');
  const tCommon = useTranslations('common');

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async () => {
    if (!email.trim()) {
      setFieldError(tCommon('required'));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setFieldError(t('invalidEmail'));
      return;
    }
    setFieldError(undefined);
    setApiError(null);
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setStep('success');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      // Endpoint isn't built on the backend yet — see the TODO on
      // api.forgotPassword(). Treat "not found" as success rather than
      // dead-ending the flow on missing backend work.
      if (err instanceof ApiError && err.statusCode === 404) {
        setStep('success');
        setCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        setApiError(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleResend = () => {
    if (cooldown > 0 || loading) return;
    submit();
  };

  return (
    <AuthLayout tagline={t('tagline')} subTagline={t('subTagline')}>
      {step === 'request' && (
        <div className={styles.section}>
          <div className={styles.heading}>
            <h1 className={styles.title}>{t('title')}</h1>
            <p className={styles.subtitle}>{t('subtitle')}</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <Input
              label={t('emailLabel')}
              type="email"
              autoComplete="email"
              required
              disabled={loading}
              value={email}
              error={fieldError}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldError) setFieldError(undefined);
              }}
              className="auth-input"
            />

            {apiError && <ErrorMessage message={apiError} />}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              className="auth-primary-button"
            >
              {t('submitButton')}
            </Button>
          </form>

          <p className={styles.backLink}>
            <Link href="/auth/login">{t('backToLogin')}</Link>
          </p>
        </div>
      )}

      {step === 'success' && (
        <div className={styles.section}>
          <AuthStatusIcon variant="success" />
          <div className={styles.heading}>
            <h1 className={styles.title}>{t('successTitle')}</h1>
            <p className={styles.subtitle}>{t('successSubtitle', { email })}</p>
          </div>

          <p className={styles.resendRow}>
            {t('resendPrompt')}{' '}
            {cooldown > 0 ? (
              <span className={styles.resendCountdown}>{t('resendCountdown', { seconds: cooldown })}</span>
            ) : (
              <button type="button" className={styles.resendLink} onClick={handleResend} disabled={loading}>
                {t('resend')}
              </button>
            )}
          </p>

          <p className={styles.backLink}>
            <Link href="/auth/login">{t('backToLogin')}</Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
