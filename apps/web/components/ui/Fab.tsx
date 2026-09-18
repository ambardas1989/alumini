'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Fab.module.css';

interface FabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

/** Fixed bottom-end floating action button — sits above BottomNav, safe-area aware. */
export function Fab({ icon, label, ...rest }: FabProps) {
  return (
    <button type="button" className={styles.fab} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  );
}
