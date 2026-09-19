import { brand } from '@/lib/brand';
import styles from './Wordmark.module.css';

export type WordmarkSize = 'sm' | 'lg';

interface WordmarkProps {
  size?: WordmarkSize;
  /** White text instead of --color-primary — for use over AuthLayout's dark purple gradient panel. */
  inverse?: boolean;
}

/** The AlumTribe name, styled — used at the top of every auth/onboarding screen. */
export function Wordmark({ size = 'lg', inverse = false }: WordmarkProps) {
  return (
    <span className={`${styles.wordmark} ${styles[size]} ${inverse ? styles.inverse : ''}`}>{brand.name}</span>
  );
}
