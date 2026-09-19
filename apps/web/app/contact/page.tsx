'use client';

import { useTranslations } from '@/lib/useTranslations';
import { StaticPageLayout } from '@/components/layout/StaticPageLayout';
import styles from './page.module.css';

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function MailIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 6-10 7L2 6" />
    </svg>
  );
}

function LifeBuoyIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="m4.93 4.93 4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22V15" />
    </svg>
  );
}

const SECTIONS = [
  { key: 'general', mailto: 'mailto:hello@alumtribe.com', icon: <MailIcon /> },
  { key: 'support', mailto: 'mailto:hello@alumtribe.com?subject=Support%20request', icon: <LifeBuoyIcon /> },
  { key: 'report', mailto: 'mailto:hello@alumtribe.com?subject=Report%3A%20', icon: <FlagIcon /> },
] as const;

export default function ContactPage() {
  const t = useTranslations('contact');
  const tCommon = useTranslations('common');

  return (
    <StaticPageLayout
      footerLinks={[
        { href: '/privacy', label: tCommon('privacyLink') },
        { href: '/terms', label: tCommon('termsLink') },
      ]}
    >
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.subtitle}>{t('subtitle')}</p>

      <div className={styles.cards}>
        {SECTIONS.map((section) => (
          <a key={section.key} href={section.mailto} className={styles.card}>
            <span className={styles.cardIcon} aria-hidden="true">
              {section.icon}
            </span>
            <span className={styles.cardText}>
              <p className={styles.cardLabel}>{t(`${section.key}.label`)}</p>
              <p className={styles.cardEmail}>hello@alumtribe.com</p>
              <p className={styles.cardDescription}>{t(`${section.key}.description`)}</p>
            </span>
          </a>
        ))}
      </div>

      <p className={styles.note}>{t('note')}</p>
    </StaticPageLayout>
  );
}
