'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { setToken } from '@/lib/auth';
import { setMfaPendingSession } from '@/lib/mfaSession';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/lib/useTranslations';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { GoogleButton } from '@/components/ui/GoogleButton';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn, login: establishSession } = useAuth();
  const t = useTranslations('auth.login');
  const tCommon = useTranslations('common');
  const tBrand = useTranslations('brand');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = searchParams.get('message');
  // session_expired is a mild "something interrupted you" event (warning
  // styling); signed_out and password_reset are both normal, expected
  // actions the user just took (neutral/info styling) — different semantic
  // weight, different color.
  const banner =
    message === 'session_expired'
      ? { text: t('sessionExpiredBanner'), variant: 'warning' as const }
      : message === 'signed_out'
        ? { text: t('signedOutBanner'), variant: 'info' as const }
        : message === 'password_reset'
          ? { text: t('passwordResetBanner'), variant: 'info' as const }
          : null;

  // Nothing left for an already-logged-in visitor to do on this screen.
  useEffect(() => {
    if (isLoggedIn) router.replace('/');
  }, [isLoggedIn, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.login(email, password);

      if ('mfaRequired' in result) {
        setMfaPendingSession({ token: result.mfaPendingToken, method: result.mfaMethod });
        router.push('/auth/mfa');
        return;
      }

      // Direct session, no MFA step — unreachable today (MFA_REQUIRED is
      // hardcoded true in packages/config/app.ts) but handled correctly in
      // case that ever changes. TokenPairResponse's own embedded `user`
      // (AuthUserSummary) is missing avatarUrl/activePersona, which this
      // app's User type needs, so a real profile fetch is required here —
      // GET /identity/profile (api.getProfile()), not /identity/me, which
      // doesn't exist as a route (see identity.controller.ts).
      setToken(result.accessToken);
      const expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
      const profile = await api.getProfile();
      establishSession({
        accessToken: result.accessToken,
        expiresAt,
        user: {
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          avatarUrl: profile.avatarUrl ?? null,
          activePersona: profile.activePersona,
        },
      });
      router.push('/');
    } catch (err) {
      setError(getErrorMessage(err));
      setLoading(false);
    }
  };

  return (
    <AuthLayout tagline={tBrand('tagline')} subTagline={t('subTagline')}>
      <div className={styles.authSection}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{t('title')}</h1>
          <p className={styles.subtitle}>{t('subtitle')}</p>
        </div>

        {banner && (
          <div className={`${styles.banner} ${banner.variant === 'info' ? styles.bannerInfo : ''}`}>
            {banner.text}
          </div>
        )}

        <GoogleButton label={t('googleButton')} />

        <div className={styles.divider}>
          <span className={styles.dividerLine} />
          <span className={styles.dividerText}>{tCommon('or')}</span>
          <span className={styles.dividerLine} />
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Input
            label={t('emailLabel')}
            type="email"
            autoComplete="email"
            required
            disabled={loading}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="auth-input"
          />
          <PasswordInput
            label={t('passwordLabel')}
            autoComplete="current-password"
            required
            disabled={loading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
          />

          <Link href="/auth/forgot-password" className={styles.forgotPassword}>
            {t('forgotPassword')}
          </Link>

          {error && <ErrorMessage message={error} />}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
            className="auth-primary-button"
          >
            {t('signInButton')}
          </Button>
        </form>

        <p className={styles.signupLink}>
          <Link href="/auth/signup">{t('signupLink')}</Link>
        </p>

        <p className={styles.footer}>
          <Link href="/terms">{tCommon('termsLink')}</Link>
          <span className={styles.footerSeparator}>|</span>
          <Link href="/privacy">{tCommon('privacyLink')}</Link>
          <span className={styles.footerSeparator}>|</span>
          <Link href="/contact">{tCommon('contactLink')}</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
