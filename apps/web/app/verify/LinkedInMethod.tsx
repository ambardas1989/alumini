'use client';

import { useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { Button } from '@/components/ui/Button';
import { LinkedInButton } from '@/components/ui/LinkedInButton';
import type { MethodProps } from './types';
import styles from './LinkedInMethod.module.css';

interface LinkedInMethodProps extends MethodProps {
  institutionName: string;
  batchYear: number;
}

/**
 * The task spec describes a "Connect LinkedIn" OAuth redirect, but no
 * LinkedIn OAuth connection endpoint exists on the backend — verifyLinkedIn()
 * only checks an *already*-connected profile.linkedin_verified flag (set by
 * some other, unbuilt flow) against this classroom's institution/year. This
 * button calls that check directly; its own error message covers the "not
 * connected yet" case since there's nowhere to send the user to connect.
 */
export function LinkedInMethod({ classroomId, institutionName, batchYear, onVerified }: LinkedInMethodProps) {
  const t = useTranslations('verification.methods.linkedin');

  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<'match' | 'noMatch' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const { verified } = await api.verifyLinkedIn(classroomId);
      if (verified) {
        setResult('match');
        onVerified();
      } else {
        setResult('noMatch');
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <p className={styles.instruction}>{t('instruction')}</p>
      <ul className={styles.trustList}>
        <li>✓ {t('trustEducationOnly')}</li>
        <li>✓ {t('trustNoPosting')}</li>
      </ul>

      <LinkedInButton disabled={checking} onClick={handleConnect}>
        {checking ? t('connecting') : t('connectButton')}
      </LinkedInButton>

      {error && <p className={styles.errorText}>{error}</p>}

      {result === 'noMatch' && (
        <div className={styles.noMatchCard}>
          <p className={styles.noMatchTitle}>{t('noMatchTitle')}</p>
          <p className={styles.noMatchBody}>{t('noMatchBody', { institution: institutionName, year: batchYear })}</p>
          <Button variant="secondary" size="sm" onClick={handleConnect}>
            {t('tryAgainButton')}
          </Button>
        </div>
      )}
    </div>
  );
}
