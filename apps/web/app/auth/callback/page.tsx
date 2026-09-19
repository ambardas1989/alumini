'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as api from '@/lib/api';
import { setToken, setTokenExpiry } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/lib/useTranslations';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

/**
 * Lands here from GET /auth/google/callback's redirect for a user who
 * already has MFA enrolled — the backend has issued a real session
 * already, this page just has to adopt it client-side (see
 * auth.controller.ts's googleCallback()).
 *
 * NOTE: unreachable in this app's current configuration.
 * appConfig.MFA_REQUIRED is hardcoded `true` (packages/config/app.ts), so
 * AuthService.loginWithGoogle() always resolves its `mfaRequired: true`
 * branch instead — every real Google sign-in goes through /auth/mfa, not
 * here. Built anyway in case that config ever changes, and left wrapped in
 * AuthLayout like every other auth screen for the same reason.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login: establishSession } = useAuth();
  const t = useTranslations('auth.callback');

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const expiresAt = searchParams.get('expiresAt');

    if (!accessToken || !expiresAt) {
      router.replace('/auth/login');
      return;
    }

    // Strip the token out of the address bar before doing anything else
    // with it — it shouldn't linger in browser history either way.
    router.replace('/auth/callback');

    // getProfile() authenticates with whatever lib/auth.ts's getToken()
    // returns, so the token has to be persisted before calling it — the
    // callback's redirect only carries accessToken/expiresAt, not the
    // profile itself, unlike /auth/mfa/verify's response.
    setToken(accessToken);
    setTokenExpiry(expiresAt);

    api
      .getProfile()
      .then((profile) => {
        establishSession({
          accessToken,
          expiresAt,
          user: {
            id: profile.id,
            email: profile.email,
            fullName: profile.fullName,
            avatarUrl: profile.avatarUrl ?? null,
            activePersona: profile.activePersona,
          },
        });
        router.replace('/');
      })
      .catch((err) => {
        setError(getErrorMessage(err));
      });
    // Deliberately runs once — re-reading searchParams after the replace()
    // above would find nothing left to act on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthLayout tagline={t('tagline')} subTagline={t('subTagline')}>
      <div className={styles.section}>
        {error ? (
          <ErrorMessage message={error} fullPage onRetry={() => router.replace('/auth/login')} />
        ) : (
          <>
            <LoadingSpinner size="lg" />
            <p className={styles.message}>{t('signingIn')}</p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
