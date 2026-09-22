import styles from './Badge.module.css';

export type BadgeVariant =
  | 'verified'
  | 'pending'
  | 'pending_auto'
  | 'rejected'
  | 'creator'
  | 'teacher'
  | 'admin'
  | 'student'
  | 'linkedin';

export type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  variant: BadgeVariant;
  label: string;
  size?: BadgeSize;
}

export function Badge({ variant, label, size = 'sm' }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]} ${styles[size]}`}>{label}</span>;
}
