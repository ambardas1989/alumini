'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as api from '@/lib/api';
import type { LinkedinConnectData } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { getLinkedInRedirectUri } from '@/lib/linkedin';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

type Phase = 'exchanging' | 'confirm' | 'saving' | 'error';

/**
 * TASKS_05 TASK 06's spec described a checkbox list of photo/job-title/
 * company/location/education — all but photo and name were dropped (see
 * auth.service.ts's connectLinkedin() doc comment for why), so this
 * confirmation panel only ever has two checkboxes.
 */
export default function LinkedInCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready } = useRequireAuth();
  const { showToast } = useToast();
  const t = useTranslations('linkedinConnect');

  const [phase, setPhase] = useState<Phase>('exchanging');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LinkedinConnectData | null>(null);
  const [confirmName, setConfirmName] = useState(true);
  const [confirmAvatar, setConfirmAvatar] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const expectedState = sessionStorage.getItem('linkedin_oauth_state');
    sessionStorage.removeItem('linkedin_oauth_state');

    if (!code || !state || state !== expectedState) {
      setError(t('invalidCallback'));
      setPhase('error');
      return;
    }

    api
      .connectLinkedin(code, getLinkedInRedirectUri())
      .then((res) => {
        setData(res.linkedinData);
        setPhase('confirm');
      })
      .catch((err) => {
        setError(getErrorMessage(err));
        setPhase('error');
      });
    // Deliberately runs once — re-reading searchParams after this wouldn't find anything new to act on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await api.saveLinkedin({
        linkedinId: data.linkedinId,
        confirmName,
        name: data.name,
        confirmAvatar,
        avatarUrl: data.avatarUrl,
      });
      showToast(t('savedToast'), 'success');
      router.replace('/profile');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return null;

  return (
    <AppShell showNav={false}>
      <PageHeader title={t('title')} />
      <PageContainer>
        {(phase === 'exchanging' || phase === 'saving') && (
          <div className={styles.centeredLoading}>
            <LoadingSpinner size="lg" />
          </div>
        )}

        {phase === 'error' && (
          <ErrorMessage message={error ?? t('invalidCallback')} fullPage onRetry={() => router.replace('/profile')} />
        )}

        {phase === 'confirm' && data && (
          <div className={styles.confirmCard}>
            <p className={styles.heading}>{t('foundHeading')}</p>

            {data.avatarUrl && (
              <label className={styles.fieldRow}>
                <input type="checkbox" checked={confirmAvatar} onChange={(e) => setConfirmAvatar(e.target.checked)} />
                <Avatar avatarUrl={data.avatarUrl} fullName={data.name ?? '?'} size="md" />
                <span>{t('field.photo')}</span>
              </label>
            )}

            {data.name && (
              <label className={styles.fieldRow}>
                <input type="checkbox" checked={confirmName} onChange={(e) => setConfirmName(e.target.checked)} />
                <span>{t('field.name', { name: data.name })}</span>
              </label>
            )}

            <Button variant="primary" size="md" fullWidth loading={saving} onClick={handleSave}>
              {t('saveButton')}
            </Button>
            <button type="button" className={styles.skipLink} onClick={() => router.replace('/profile')}>
              {t('skipButton')}
            </button>
          </div>
        )}
      </PageContainer>
    </AppShell>
  );
}
