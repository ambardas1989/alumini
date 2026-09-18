'use client';

import { useTranslations } from '@/lib/useTranslations';
import styles from './PasswordStrength.module.css';

interface PasswordStrengthProps {
  password: string;
}

type Strength = 'weak' | 'fair' | 'strong';

/**
 * Weak/Fair/Strong per the task spec: length >= 8, has a digit, has a
 * special character — each satisfied criterion adds one point, mapped to
 * a strength tier. Not a substitute for the backend's own password policy
 * (SignupDto still enforces length + letter + digit) — this is UI
 * feedback only.
 */
function scorePassword(password: string): Strength {
  let score = 0;
  if (password.length >= 8) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score >= 3) return 'strong';
  if (score === 2) return 'fair';
  return 'weak';
}

const WIDTH: Record<Strength, string> = { weak: '33%', fair: '66%', strong: '100%' };

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const t = useTranslations('auth.signup.passwordStrength');

  if (!password) return null;

  const strength = scorePassword(password);

  return (
    <div className={styles.wrap}>
      <div className={styles.track} role="img" aria-label={`${t('label')}: ${t(strength)}`}>
        <div className={`${styles.fill} ${styles[strength]}`} style={{ width: WIDTH[strength] }} />
      </div>
      <span className={`${styles.label} ${styles[strength]}`}>{t(strength)}</span>
    </div>
  );
}
