import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import styles from './AuthCard.module.css';

interface AuthCardProps {
  children: ReactNode;
}

/** Centered card, full height, no bottom nav — shared by login/signup/MFA. */
export function AuthCard({ children }: AuthCardProps) {
  return (
    <AppShell showNav={false}>
      <div className={styles.wrap}>
        <div className={styles.card}>{children}</div>
      </div>
    </AppShell>
  );
}
