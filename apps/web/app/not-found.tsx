'use client';

import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import { useTranslations } from '@/lib/useTranslations';
import styles from './not-found.module.css';

export default function NotFound() {
  const t = useTranslations('notFound');

  return (
    <div className={styles.page}>
      <Wordmark size="lg" variant="dark" />
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.description}>{t('description')}</p>
      <Link href="/" className={styles.homeButton}>
        {t('goHome')}
      </Link>
    </div>
  );
}
