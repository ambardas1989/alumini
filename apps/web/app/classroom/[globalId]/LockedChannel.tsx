import styles from './LockedChannel.module.css';

interface LockedChannelProps {
  title: string;
  subtitle: string;
  description: string;
}

/** "This channel is for X only" — shown when the viewer's role can't access this channel. Not an error state by design. */
export function LockedChannel({ title, subtitle, description }: LockedChannelProps) {
  return (
    <div className={styles.wrap}>
      <span className={styles.lockIcon} aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.message}>{subtitle}</p>
      <p className={styles.message}>{description}</p>
    </div>
  );
}
