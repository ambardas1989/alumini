'use client';

import { useState } from 'react';
import * as api from '@/lib/api';
import { getToken } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { SheetModal } from './ui/SheetModal';
import { CodeInput } from './ui/CodeInput';
import { LoadingSpinner } from './ui/LoadingSpinner';
import styles from './MfaChallengeModal.module.css';

const MAX_ATTEMPTS = 3;

interface MfaChallengeModalProps {
  title: string;
  description: string;
  onCancel: () => void;
  onVerified: () => void;
}

/**
 * Re-authorises a sensitive action for an already-logged-in user — backed
 * by POST /auth/mfa/challenge, which the backend explicitly documents as
 * dual-purpose: "completes a pending login, or re-authorises a sensitive
 * action" (see apps/backend auth.controller.ts). Shared by every admin
 * action here that needs a fresh MFA proof (verification approve/reject,
 * admin removal).
 */
export function MfaChallengeModal({ title, description, onCancel, onVerified }: MfaChallengeModalProps) {
  const t = useTranslations('mfaChallenge');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockedOut, setLockedOut] = useState(false);

  const handleComplete = async (code: string) => {
    const token = getToken();
    if (!token) return;
    setVerifying(true);
    setError(false);
    try {
      await api.challengeMfa(token, code);
      onVerified();
    } catch (err) {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      setErrorMessage(getErrorMessage(err));
      if (nextAttempts >= MAX_ATTEMPTS) {
        setLockedOut(true);
      } else {
        setError(true);
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <SheetModal title={title} onClose={onCancel}>
      <p className={styles.description}>{description}</p>

      {lockedOut ? (
        <p className={styles.lockedOut}>{t('maxAttempts')}</p>
      ) : (
        <>
          <CodeInput label={t('codeLabel')} onComplete={handleComplete} disabled={verifying} error={error} />
          {verifying && (
            <div className={styles.spinnerRow}>
              <LoadingSpinner size="sm" />
            </div>
          )}
          {errorMessage && !lockedOut && <p className={styles.errorText}>{errorMessage}</p>}
        </>
      )}
    </SheetModal>
  );
}
