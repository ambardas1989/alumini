'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

/**
 * TASKS_11 TASK 01 — accept an institution-admin invite via its magic-link
 * token. Not logged in: shows a login prompt (this codebase has no
 * returnUrl-after-login convention yet to wire up a redirect-back, so the
 * invite link is simply revisited after logging in — same limitation the
 * task's own "redirect to login with returnUrl" line would otherwise need
 * new login-page plumbing to satisfy).
 */
export default function AcceptInstitutionAdminInvitePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn } = useAuth();
  const t = useTranslations('institutionAdmin.acceptInvite');

  const token = searchParams.get('token') ?? '';
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !isLoggedIn) return;
    let cancelled = false;
    api
      .previewInstitutionAdminInvite(token)
      .then((data) => {
        if (!cancelled) setInstitutionName(data.institutionName);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, isLoggedIn]);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const result = await api.acceptInstitutionAdminInvite(token);
      router.push(`/institution-admin/${result.institutionId}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAccepting(false);
    }
  };

  return (
    <AppShell showNav={false}>
      <PageHeader title={t('title')} />
      <PageContainer>
        <div className={styles.wrap}>
          {!token ? (
            <ErrorMessage message={t('invalidToken')} />
          ) : !isLoggedIn ? (
            <>
              <p className={styles.prompt}>{t('loginRequired')}</p>
              <Button variant="primary" size="lg" fullWidth onClick={() => router.push('/auth/login')}>
                {t('loginButton')}
              </Button>
            </>
          ) : previewError ? (
            <ErrorMessage message={previewError} />
          ) : (
            <>
              <p className={styles.prompt}>{t('acceptPrompt', { institution: institutionName ?? '' })}</p>
              {error && <ErrorMessage message={error} />}
              <Button variant="primary" size="lg" fullWidth loading={accepting} onClick={handleAccept}>
                {t('acceptButton')}
              </Button>
            </>
          )}
        </div>
      </PageContainer>
    </AppShell>
  );
}
