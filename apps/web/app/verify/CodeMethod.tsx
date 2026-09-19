'use client';

import { useState } from 'react';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { MethodProps } from './types';
import styles from './CodeMethod.module.css';

const CODE_FORMAT_RE = /^[A-Z]{2}-\d{4}-[A-Z0-9]{6}$/;

const ERROR_KEY: Record<string, string> = {
  VERIFICATION_CODE_INVALID: 'errors.invalid',
  VERIFICATION_CODE_EXPIRED: 'errors.expired',
  VERIFICATION_CODE_REDEEMED: 'errors.redeemed',
};

export function CodeMethod({ classroomId, onVerified }: MethodProps) {
  const t = useTranslations('verification.methods.code');

  const [code, setCode] = useState('');
  const [formatError, setFormatError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleBlur = () => {
    if (code && !CODE_FORMAT_RE.test(code)) {
      setFormatError(t('errors.badFormat'));
    } else {
      setFormatError(null);
    }
  };

  const handleSubmit = async () => {
    if (!CODE_FORMAT_RE.test(code)) {
      setFormatError(t('errors.badFormat'));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.redeemCode(classroomId, code);
      if (result.verified) onVerified();
    } catch (err) {
      const errCode = err instanceof ApiError ? err.errorCode : null;
      const key = errCode ? ERROR_KEY[errCode] : undefined;
      setSubmitError(key ? t(key) : getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <p className={styles.instruction}>{t('instruction')}</p>
      <p className={styles.hint}>{t('formatHint')}</p>
      <Input
        label={t('codeLabel')}
        value={code}
        error={formatError ?? submitError ?? undefined}
        className={styles.monoInput}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase());
          setFormatError(null);
          setSubmitError(null);
        }}
        onBlur={handleBlur}
      />
      <Button
        variant="primary"
        size="md"
        fullWidth
        disabled={!CODE_FORMAT_RE.test(code)}
        loading={submitting}
        onClick={handleSubmit}
      >
        {t('verifyButton')}
      </Button>
    </div>
  );
}
