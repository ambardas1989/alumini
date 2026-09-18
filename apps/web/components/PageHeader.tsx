'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useTranslations } from '@/lib/useTranslations';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  showBack?: boolean;
  rightAction?: ReactNode;
}

export function PageHeader({ title, showBack = false, rightAction }: PageHeaderProps) {
  const router = useRouter();
  const t = useTranslations('common');

  return (
    <header className={styles.header}>
      {showBack && (
        <button type="button" className={styles.back} onClick={() => router.back()} aria-label={t('goBack')}>
          ←
        </button>
      )}
      <h1 className={styles.title}>{title}</h1>
      {rightAction && <div className={styles.right}>{rightAction}</div>}
    </header>
  );
}
