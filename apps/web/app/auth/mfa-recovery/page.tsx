'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { AuthStatusIcon } from '@/components/ui/AuthStatusIcon';
import styles from './page.module.css';

/**
 * Lands here from the "Recover access to your account" email
 * (AuthService.requestMfaRecovery()). Verifying the token clears MFA
 * entirely and hands back a fresh mfa_setup pending token — this page's
 * only job is to adopt that token the same way auth.controller.ts's
 * googleCallback() redirect does, then send the user into /auth/mfa's
 * existing setup flow (?recovered=true swaps in the "please set up
 * again" subtitle there instead of the fresh-account one).
 */
export default function MfaRecoveryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('auth.mfaRecovery');

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      router.replace('/auth/login');
      return;
    }

    api
      .verifyMfaRecovery(token)
      .then((result) => {
        const params = new URLSearchParams({
          token: result.mfaPendingToken,
          setup: 'true',
          recovered: 'true',
        });
        router.replace(`/auth/mfa?${params}`);
      })
      .catch((err) => {
        setError(getErrorMessage(err));
      });
    // Deliberately runs once — the token is only good for a single verify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthLayout tagline={t('tagline')} subTagline={t('subTagline')}>
      <div className={styles.section}>
        {error ? (
          <>
            <AuthStatusIcon variant="error" />
            <h1 className={styles.title}>{t('expiredTitle')}</h1>
            <p className={styles.subtitle}>{t('expiredSubtitle')}</p>
            <Link href="/auth/login" className={styles.backLink}>
              {t('backToLogin')}
            </Link>
          </>
        ) : (
          <>
            <LoadingSpinner size="lg" />
            <p className={styles.message}>{t('verifying')}</p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
