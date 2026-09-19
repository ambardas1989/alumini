'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import { useTranslations } from '@/lib/useTranslations';
import styles from './StaticPageLayout.module.css';

interface FooterLink {
  href: string;
  label: string;
}

interface StaticPageLayoutProps {
  children: ReactNode;
  /** Shown as a row of links under the content — e.g. "Terms of Service | Contact" on the Privacy page. */
  footerLinks?: FooterLink[];
}

/**
 * Shared shell for public, no-auth-required content pages (privacy, terms,
 * contact). Deliberately not AppShell — those pages are the "phone app"
 * chrome for logged-in screens; this is a plain document layout, and none
 * of these pages need a bottom nav.
 */
export function StaticPageLayout({ children, footerLinks }: StaticPageLayoutProps) {
  const t = useTranslations('common');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Wordmark size="sm" />
        <Link href="/" className={styles.backLink}>
          {t('backToHome')}
        </Link>
      </header>

      <main className={styles.content}>{children}</main>

      {footerLinks && footerLinks.length > 0 && (
        <footer className={styles.footer}>
          {footerLinks.map((link, i) => (
            <span key={link.href} className={styles.footerItem}>
              {i > 0 && <span className={styles.footerSeparator}>|</span>}
              <Link href={link.href} className={styles.footerLink}>
                {link.label}
              </Link>
            </span>
          ))}
        </footer>
      )}
    </div>
  );
}
