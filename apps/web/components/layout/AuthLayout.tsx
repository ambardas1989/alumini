'use client';

import type { ReactNode } from 'react';
import { useTranslations } from '@/lib/useTranslations';
import Wordmark from '@/components/Wordmark';
import styles from './AuthLayout.module.css';

interface AuthLayoutProps {
  tagline: string;
  subTagline: string;
  children: ReactNode;
}

interface StatDef {
  number: string;
  labelKey: 'alumni' | 'schools' | 'cities';
  icon: ReactNode;
}

// Placeholder stats, hardcoded — no endpoint exists that aggregates
// platform-wide alumni/school/city counts.
// TODO: replace with real stats from API
const STATS: StatDef[] = [
  { number: '10,000+', labelKey: 'alumni', icon: <UsersIcon /> },
  { number: '500+', labelKey: 'schools', icon: <SchoolIcon /> },
  { number: '50+', labelKey: 'cities', icon: <PinIcon /> },
];

/**
 * Split-screen shell for every auth page (login, signup, mfa,
 * forgot-password, reset-password). Deliberately NOT built on AppShell —
 * AppShell's `.app-shell` caps width at --app-max-width (480px) to keep a
 * "phone app on desktop" feel everywhere else in this app, which is exactly
 * what a wide desktop split-screen needs to break out of.
 */
export function AuthLayout({ tagline, subTagline, children }: AuthLayoutProps) {
  const t = useTranslations('auth.stats');

  return (
    <div className={styles.wrap}>
      <div className={styles.leftPanel}>
        <div className={styles.dotOverlay} aria-hidden="true" />

        <Wordmark size="md" variant="dark" />

        <div className={styles.center}>
          <p className={styles.tagline}>{tagline}</p>
          <p className={styles.subTagline}>{subTagline}</p>
        </div>

        <div className={styles.stats}>
          {STATS.map((stat) => (
            <div key={stat.labelKey} className={styles.statCard}>
              <span className={styles.statIcon} aria-hidden="true">
                {stat.icon}
              </span>
              <span className={styles.statText}>
                <span className={styles.statNumber}>{stat.number}</span>
                <span className={styles.statLabel}>{t(stat.labelKey)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.rightPanel}>
        <div className={styles.rightInner}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Small line icons matching Tabler's visual style (24px, stroke-based,
 * rounded caps) — hand-rolled rather than adding the @tabler/icons package
 * or its webfont CDN for three decorative, one-off icons; every other icon
 * in this app (BottomNav, home page's bell/plus, GoogleIcon, ...) is
 * already a local inline SVG, so this matches the established convention.
 */
const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function UsersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SchoolIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="m22 10-10-6L2 10l10 6 10-6Z" />
      <path d="M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
