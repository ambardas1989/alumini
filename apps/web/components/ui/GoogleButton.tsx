'use client';

import * as api from '@/lib/api';
import { useTranslations } from '@/lib/useTranslations';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import styles from './GoogleButton.module.css';

// The web app has no way to introspect a server-only env var (whether the
// backend actually has GOOGLE_CLIENT_ID configured) — this is a manual
// flag. See apps/web/.env.local's own comment.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true';

interface GoogleButtonProps {
  /** "Sign in with Google" / "Sign up with Google" — same button, different label per page. */
  label: string;
}

/**
 * Shared by login and signup — same onClick, same API call either way
 * (POST-redirect to GET /auth/google, which creates an account if new or
 * logs in if existing; see AuthService.loginWithGoogle() on the backend).
 */
export function GoogleButton({ label }: GoogleButtonProps) {
  const t = useTranslations('auth');

  return (
    <button
      type="button"
      className={`${styles.button} auth-google-button`}
      disabled={!GOOGLE_ENABLED}
      title={GOOGLE_ENABLED ? undefined : t('googleComingSoon')}
      onClick={() => {
        window.location.href = api.googleAuth();
      }}
    >
      <GoogleIcon />
      {label}
    </button>
  );
}
