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
}

interface FeatureDef {
  key: 'verified' | 'channels' | 'forever';
  icon: ReactNode;
}

// Placeholder stats, hardcoded — no endpoint exists that aggregates
// platform-wide alumni/school/city counts.
// TODO: replace with real stats from API
const STATS: StatDef[] = [
  { number: '10,000+', labelKey: 'alumni' },
  { number: '500+', labelKey: 'schools' },
  { number: '50+', labelKey: 'cities' },
];

const FEATURES: FeatureDef[] = [
  { key: 'verified', icon: <ShieldCheckIcon /> },
  { key: 'channels', icon: <MessagesIcon /> },
  { key: 'forever', icon: <HeartIcon /> },
];

/**
 * Split-screen shell for every auth page (login, signup, mfa,
 * forgot-password, reset-password). Deliberately NOT built on AppShell —
 * AppShell's `.app-shell` caps width at --app-max-width (480px) to keep a
 * "phone app on desktop" feel everywhere else in this app, which is exactly
 * what a wide desktop split-screen needs to break out of.
 *
 * No rotation state anymore — an earlier pass had the three feature cards
 * auto-rotating on a timer (useState/useEffect/setInterval); removed in
 * favor of showing all three stacked at once. Still 'use client' purely
 * because useTranslations() is a hook.
 */
export function AuthLayout({ tagline, subTagline, children }: AuthLayoutProps) {
  const t = useTranslations('auth.stats');
  const tFeatures = useTranslations('auth.features');

  return (
    <div className={styles.wrap}>
      <div className={styles.leftPanel}>
        <div className={styles.dotOverlay} aria-hidden="true" />

        <Wordmark size="md" variant="dark" />

        <div className={styles.center}>
          <p className={styles.tagline}>{tagline}</p>
          <p className={styles.subTagline}>{subTagline}</p>

          <div className={styles.cardStack}>
            {FEATURES.map((feature) => (
              <div key={feature.key} className={styles.featureCard}>
                <span className={styles.featureIcon} aria-hidden="true">
                  {feature.icon}
                </span>
                <span className={styles.featureText}>
                  <p className={styles.featureTitle}>{tFeatures(`${feature.key}.title`)}</p>
                  <p className={styles.featureBody}>{tFeatures(`${feature.key}.body`)}</p>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.stats}>
          {STATS.map((stat) => (
            <span key={stat.labelKey} className={styles.statPill}>
              {stat.number} {t(stat.labelKey)}
            </span>
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
 * Small line icons matching Tabler's visual style (24px viewBox,
 * stroke-based, rounded caps) — hand-rolled rather than adding the
 * @tabler/icons package or its webfont CDN for three decorative, one-off
 * icons; every other icon in this app (BottomNav, home page's bell/plus,
 * GoogleIcon, ...) is already a local inline SVG, so this matches the
 * established convention.
 */
const ICON_PROPS = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function ShieldCheckIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function MessagesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M14 9a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4Z" />
      <path d="M18 9h.01M9 15v1a2 2 0 0 0 2 2h5l3 3v-9a2 2 0 0 0-1.34-1.89" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M19.5 12.572 12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.566Z" />
    </svg>
  );
}
