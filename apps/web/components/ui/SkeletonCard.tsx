import styles from './SkeletonCard.module.css';

/** Shimmer placeholder matching ClassroomCard's dimensions — shown while a classroom list loads. */
export function SkeletonCard() {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={`${styles.bar} ${styles.sub}`} />
      <div className={`${styles.bar} ${styles.title}`} />
      <div className={styles.row}>
        <div className={`${styles.bar} ${styles.stat}`} />
        <div className={`${styles.bar} ${styles.badge}`} />
      </div>
    </div>
  );
}
