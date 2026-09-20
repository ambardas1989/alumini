'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useTranslations } from '@/lib/useTranslations';
import styles from './BottomNav.module.css';

interface Tab {
  href: string;
  labelKey: 'home' | 'classes' | 'messages' | 'profile';
  icon: ReactNode;
}

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const TABS: Tab[] = [
  {
    href: '/',
    labelKey: 'home',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v10h14V10" />
      </svg>
    ),
  },
  {
    // TASK 08: Classes is now the classroom directory (/classes), not the
    // creation form — was pointed at /classroom/create as a workaround
    // before this page existed.
    href: '/classes',
    labelKey: 'classes',
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M9 4v16" />
      </svg>
    ),
  },
  {
    href: '/messages',
    labelKey: 'messages',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 4h16v12H8l-4 4V4Z" />
      </svg>
    ),
  },
  {
    href: '/profile',
    labelKey: 'profile',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <nav className={styles.nav} aria-label={t('primaryLabel')}>
      {TABS.map((tab) => {
        // "Classes" should read active on /classes itself and on any
        // /classroom/* route (create form, detail view) — those aren't
        // under /classes, so a plain startsWith(tab.href) alone would miss them.
        const active =
          tab.href === '/'
            ? pathname === '/'
            : tab.labelKey === 'classes'
              ? pathname.startsWith('/classes') || pathname.startsWith('/classroom')
              : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[styles.tab, active ? styles.active : ''].filter(Boolean).join(' ')}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.icon}>{tab.icon}</span>
            <span className={styles.label}>{t(tab.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
