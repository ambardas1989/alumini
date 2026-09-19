import styles from './AuthStatusIcon.module.css';

export type AuthStatusIconVariant = 'success' | 'error';

interface AuthStatusIconProps {
  variant: AuthStatusIconVariant;
}

/**
 * Animated circle + check (or X) for the forgot/reset-password success and
 * expired-token states. The draw-in animation is plain CSS — the global
 * prefers-reduced-motion override in app/globals.css already zeroes every
 * animation-duration site-wide, so this needs no extra handling here.
 */
export function AuthStatusIcon({ variant }: AuthStatusIconProps) {
  return (
    <div
      className={`${styles.circle} ${variant === 'success' ? styles.success : styles.error}`}
      aria-hidden="true"
    >
      {variant === 'success' ? (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path
            className={styles.path}
            d="M8 16.5 13.5 22 24 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path
            className={styles.path}
            d="M10 10 22 22M22 10 10 22"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  );
}
