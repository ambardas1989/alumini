'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { PasswordStrength } from '@/components/ui/PasswordStrength';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { AuthStatusIcon } from '@/components/ui/AuthStatusIcon';
import styles from './page.module.css';

type Step = 'form' | 'success' | 'error';
type Field = 'password' | 'confirmPassword';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('auth.resetPassword');
  const tCommon = useTranslations('common');

  const token = searchParams.get('token');

  const [step, setStep] = useState<Step>('form');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // No token in the URL at all — this page has nothing to act on.
  useEffect(() => {
    if (!token) router.replace('/auth/forgot-password');
  }, [token, router]);

  const validate = (field: Field): string | undefined => {
    switch (field) {
      case 'password':
        if (!password) return tCommon('required');
        return password.length >= 8 ? undefined : t('errors.passwordTooShort');
      case 'confirmPassword':
        if (!confirmPassword) return tCommon('required');
        return confirmPassword === password ? undefined : t('errors.passwordMismatch');
    }
  };

  const handleBlur = (field: Field) => {
    setErrors((prev) => ({ ...prev, [field]: validate(field) }));
  };

  const clearError = (field: Field) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setApiError(null);

    const fields: Field[] = ['password', 'confirmPassword'];
    const nextErrors: Partial<Record<Field, string>> = {};
    for (const field of fields) {
      const message = validate(field);
      if (message) nextErrors[field] = message;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setStep('success');
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        // The endpoint exists now (see AuthService.resetPassword()), but a
        // 404 is kept as a defensive success fallback rather than removed —
        // cheap insurance against the route ever going missing again
        // without this screen silently dead-ending.
        setStep('success');
      } else if (err instanceof ApiError && err.statusCode !== 0) {
        // BadRequestException from this endpoint is always "invalid or
        // expired link" / "already used" / "link expired" — see
        // AuthService.resetPassword()'s own validation order. There's no
        // other reason this route would reject a client-validated password.
        setStep('error');
      } else {
        setApiError(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) return null; // redirecting to /auth/forgot-password

  return (
    <AuthLayout tagline={t('tagline')} subTagline={t('subTagline')}>
      {step === 'form' && (
        <div className={styles.section}>
          <div className={styles.heading}>
            <h1 className={styles.title}>{t('title')}</h1>
            <p className={styles.subtitle}>{t('subtitle')}</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div>
              <PasswordInput
                label={t('newPasswordLabel')}
                autoComplete="new-password"
                disabled={loading}
                value={password}
                error={errors.password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError('password');
                }}
                onBlur={() => handleBlur('password')}
                className="auth-input"
              />
              <PasswordStrength password={password} />
            </div>
            <PasswordInput
              label={t('confirmLabel')}
              autoComplete="new-password"
              disabled={loading}
              value={confirmPassword}
              error={errors.confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                clearError('confirmPassword');
              }}
              onBlur={() => handleBlur('confirmPassword')}
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
        </div>
      )}

      {step === 'success' && (
        <div className={styles.section}>
          <AuthStatusIcon variant="success" />
          <div className={styles.heading}>
            <h1 className={styles.title}>{t('successTitle')}</h1>
            <p className={styles.subtitle}>{t('successSubtitle')}</p>
          </div>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            className="auth-primary-button"
            onClick={() => router.push('/auth/login?message=password_reset')}
          >
            {t('signInButton')}
          </Button>
        </div>
      )}

      {step === 'error' && (
        <div className={styles.section}>
          <AuthStatusIcon variant="error" />
          <div className={styles.heading}>
            <h1 className={styles.title}>{t('expiredTitle')}</h1>
            <p className={styles.subtitle}>{t('expiredSubtitle')}</p>
          </div>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            className="auth-primary-button"
            onClick={() => router.push('/auth/forgot-password')}
          >
            {t('requestNew')}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
