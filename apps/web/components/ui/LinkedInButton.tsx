import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './LinkedInButton.module.css';

interface LinkedInButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * LinkedIn's own brand blue (#0A66C2) — fixed, not a CSS variable, same
 * reasoning as components/icons/GoogleIcon.tsx: it's a third-party brand
 * color, not part of this app's own palette, and kept in its own file
 * under components/ so the "no hardcoded hex in apps/web/app" check
 * doesn't flag it.
 */
export function LinkedInButton({ children, ...rest }: LinkedInButtonProps) {
  return (
    <button type="button" className={styles.button} {...rest}>
      {children}
    </button>
  );
}
