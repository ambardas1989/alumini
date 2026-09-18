'use client';

import type { ButtonHTMLAttributes } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      className={[styles.button, styles[variant], styles[size], fullWidth ? styles.fullWidth : '', className]
        .filter(Boolean)
        .join(' ')}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={loading}
      {...rest}
    >
      {loading && <LoadingSpinner size="sm" />}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
