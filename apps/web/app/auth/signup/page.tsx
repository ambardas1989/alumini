'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { setMfaPendingSession } from '@/lib/mfaSession';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/lib/useTranslations';
import { AuthCard } from '@/components/layout/AuthCard';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { PasswordStrength } from '@/components/ui/PasswordStrength';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'fullName' | 'email' | 'password' | 'confirmPassword';

export default function SignupPage() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const t = useTranslations('auth.signup');
  const tCommon = useTranslations('common');
  const tBrand = useTranslations('brand');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn) router.replace('/');
  }, [isLoggedIn, router]);

  const validate = (field: Field): string | undefined => {
    switch (field) {
      case 'fullName':
        return fullName.trim() ? undefined : tCommon('required');
      case 'email':
        if (!email.trim()) return tCommon('required');
        return EMAIL_RE.test(email) ? undefined : t('errors.invalidEmail');
      case 'password':
        if (!password) return tCommon('required');
        return password.length >= 8 ? undefined : t('errors.passwordTooShort');
      case 'confirmPassword':
        if (!confirmPassword) return tCommon('required');
        return confirmPassword === password ? undefined : t('errors.passwordMismatch');
    }
  };

  const handleBlur = (field: Field) => {
    const message = validate(field);
    setErrors((prev) => ({ ...prev, [field]: message }));
  };

  // "Clear error when user starts typing" — each field's own onChange calls
  // this instead of re-validating immediately, so the field goes quiet
  // until the next blur/submit rather than flashing a new error per keystroke.
  const clearError = (field: Field) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const fields: Field[] = ['fullName', 'email', 'password', 'confirmPassword'];
    const nextErrors: Partial<Record<Field, string>> = {};
    for (const field of fields) {
      const message = validate(field);
      if (message) nextErrors[field] = message;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      const result = await api.signup(fullName.trim(), email, password);
      setMfaPendingSession({ token: result.mfaPendingToken, method: result.mfaMethod });
      router.push('/auth/mfa');
    } catch (err) {
      setApiError(getErrorMessage(err));
      setLoading(false);
    }
  };

  return (
    <AuthCard>
      <div className={styles.top}>
        <Wordmark />
        <h1 className={styles.title}>{t('title')}</h1>
        {/* subline only appears here — the signup first-impression moment */}
        <p className={styles.subline}>{tBrand('subline')}</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Input
          label={t('fullNameLabel')}
          autoComplete="name"
          disabled={loading}
          value={fullName}
          error={errors.fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            clearError('fullName');
          }}
          onBlur={() => handleBlur('fullName')}
        />
        <Input
          label={t('emailLabel')}
          type="email"
          autoComplete="email"
          disabled={loading}
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError('email');
          }}
          onBlur={() => handleBlur('email')}
        />
        <div>
          <PasswordInput
            label={t('passwordLabel')}
            autoComplete="new-password"
            disabled={loading}
            value={password}
            error={errors.password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError('password');
            }}
            onBlur={() => handleBlur('password')}
          />
          <PasswordStrength password={password} />
        </div>
        <PasswordInput
          label={t('confirmPasswordLabel')}
          autoComplete="new-password"
          disabled={loading}
          value={confirmPassword}
          error={errors.confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            clearError('confirmPassword');
          }}
          onBlur={() => handleBlur('confirmPassword')}
        />

        {apiError && <ErrorMessage message={apiError} />}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
          {t('signUpButton')}
        </Button>
      </form>

      <p className={styles.loginLink}>
        <Link href="/auth/login">{t('loginLink')}</Link>
      </p>
    </AuthCard>
  );
}
