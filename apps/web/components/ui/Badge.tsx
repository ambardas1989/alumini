import styles from './Badge.module.css';

export type BadgeVariant = 'verified' | 'pending' | 'rejected' | 'teacher' | 'admin' | 'student';

interface BadgeProps {
  variant: BadgeVariant;
  label: string;
}

export function Badge({ variant, label }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]}`}>{label}</span>;
}
