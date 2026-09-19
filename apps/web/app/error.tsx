'use client';

import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import { useTranslations } from '@/lib/useTranslations';
import { Button } from '@/components/ui/Button';
import styles from './error.module.css';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ reset }: ErrorPageProps) {
  const t = useTranslations('errorBoundary');

  return (
    <div className={styles.page}>
      <Wordmark size="md" />
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.description}>{t('description')}</p>
      <Button variant="primary" size="lg" onClick={reset}>
        {t('tryAgain')}
      </Button>
      <Link href="/" className={styles.homeLink}>
        {t('goHome')}
      </Link>
    </div>
  );
}
