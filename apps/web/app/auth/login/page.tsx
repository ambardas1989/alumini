'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import styles from './page.module.css';

// Whether the backend has Google OAuth configured — the web app has no way
// to introspect a server-only env var, so this is a manual flag. See
// apps/web/.env.local's own comment.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn } = useAuth();
  const t = useTranslations('auth.login');
  const tCommon = useTranslations('common');
  const tBrand = useTranslations('brand');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = searchParams.get('message');
  // session_expired is a mild "something interrupted you" event (warning
  // styling); signed_out is a normal, expected action the user just took
  // (neutral/info styling) — different semantic weight, different color.
  const banner =
    message === 'session_expired'
      ? { text: t('sessionExpiredBanner'), variant: 'warning' as const }
      : message === 'signed_out'
        ? { text: t('signedOutBanner'), variant: 'info' as const }
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
      setMfaPendingSession({ token: result.mfaPendingToken, method: result.mfaMethod });
      router.push('/auth/mfa');
    } catch (err) {
      setError(getErrorMessage(err));
      setLoading(false);
    }
  };

  return (
    <AuthCard>
      <div className={styles.top}>
        <Wordmark />
        <p className={styles.tagline}>{tBrand('tagline')}</p>
      </div>

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

        <button
          type="button"
          className={styles.googleButton}
          disabled={!GOOGLE_ENABLED}
          title={GOOGLE_ENABLED ? undefined : t('googleComingSoon')}
          onClick={() => {
            window.location.href = api.googleAuth();
          }}
        >
          <GoogleIcon />
          {t('googleButton')}
        </button>

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
          />
          <PasswordInput
            label={t('passwordLabel')}
            autoComplete="current-password"
            required
            disabled={loading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {/* No forgot-password screen exists yet in this pass — inert
              placeholder so the link doesn't navigate anywhere broken. */}
          <a
            href="#"
            className={styles.forgotPassword}
            onClick={(e) => e.preventDefault()}
          >
            {t('forgotPassword')}
          </a>

          {error && <ErrorMessage message={error} />}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
            {t('signInButton')}
          </Button>
        </form>

        <p className={styles.signupLink}>
          <Link href="/auth/signup">{t('signupLink')}</Link>
        </p>
      </div>
    </AuthCard>
  );
}
