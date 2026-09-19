import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './LinkedInButton.module.css';

interface LinkedInButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * LinkedIn's own brand blue — now var(--color-linkedin) (app/globals.css),
 * not hardcoded here. Reused by both the verification screen's "Connect
 * LinkedIn" method and the profile screen's LinkedIn section.
 */
export function LinkedInButton({ children, ...rest }: LinkedInButtonProps) {
  return (
    <button type="button" className={styles.button} {...rest}>
      {children}
    </button>
  );
}
