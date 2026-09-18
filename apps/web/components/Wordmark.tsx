import { brand } from '@/lib/brand';
import styles from './Wordmark.module.css';

export type WordmarkSize = 'sm' | 'lg';

interface WordmarkProps {
  size?: WordmarkSize;
}

/** The AlumTribe name, styled — used at the top of every auth/onboarding screen. */
export function Wordmark({ size = 'lg' }: WordmarkProps) {
  return <span className={`${styles.wordmark} ${styles[size]}`}>{brand.name}</span>;
}
