'use client';

import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CodeInput } from '@/components/ui/CodeInput';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import type { MethodProps } from './types';
import styles from './EmailMethod.module.css';

interface EmailMethodProps extends MethodProps {
  institutionName: string;
  emailDomain: string | null;
}

const RESEND_COOLDOWN_SECONDS = 60;

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function EmailMethod({ classroomId, institutionName, emailDomain, onVerified }: EmailMethodProps) {
  const t = useTranslations('verification.methods.email');

  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [cooldown, setCooldown] = useState(0);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1 && cooldownTimer.current) clearInterval(cooldownTimer.current);
        return s - 1;
      });
    }, 1000);
  };

  const handleSend = async () => {
    if (emailDomain) {
      const domain = email.split('@')[1];
      if (domain !== emailDomain && !domain?.endsWith(`.${emailDomain}`)) {
        setEmailError(t('errors.domainMismatch', { domain: emailDomain }));
        return;
      }
    }
    setEmailError(null);
    setSending(true);
    try {
      await api.initiateEmailVerification(classroomId, email);
      setStep('otp');
      startCooldown();
    } catch (err) {
      setEmailError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async (otp: string) => {
    setConfirming(true);
    setOtpError(null);
    try {
      const result = await api.confirmEmailOtp(classroomId, otp);
      if (result.verified) onVerified();
    } catch (err) {
      const code = err instanceof ApiError ? err.errorCode : null;
      if (code === 'VERIFICATION_OTP_MAX_ATTEMPTS' || code === 'VERIFICATION_OTP_EXPIRED') {
        setStep('email');
        setOtpError(null);
      } else {
        setOtpError(getErrorMessage(err));
        setShakeKey((k) => k + 1);
      }
    } finally {
      setConfirming(false);
    }
  };

  if (step === 'email') {
    return (
      <div className={styles.wrap}>
        <p className={styles.instruction}>{t('instruction', { institution: institutionName })}</p>
        {emailDomain && <p className={styles.hint}>{t('domainHint', { domain: emailDomain })}</p>}
        <Input
          label={t('emailLabel')}
          type="email"
          value={email}
          error={emailError ?? undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(null);
          }}
        />
        <Button variant="primary" size="md" fullWidth loading={sending} disabled={!email} onClick={handleSend}>
          {t('sendButton')}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.instruction}>{t('otpInstruction', { email: maskEmail(email) })}</p>
      <CodeInput
        key={shakeKey}
        label={t('emailLabel')}
        error={!!otpError}
        disabled={confirming}
        onChange={() => setOtpError(null)}
        onComplete={handleConfirm}
      />
      {otpError && <ErrorMessage message={otpError} />}
      <div className={styles.resendRow}>
        {cooldown > 0 ? (
          <span className={styles.cooldownText}>{t('resendIn', { seconds: cooldown })}</span>
        ) : (
          <button type="button" className={styles.resendLink} onClick={handleSend} disabled={sending}>
            {t('resendLink')}
          </button>
        )}
      </div>
    </div>
  );
}
