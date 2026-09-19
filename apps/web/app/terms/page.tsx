'use client';

import { useTranslations } from '@/lib/useTranslations';
import { StaticPageLayout } from '@/components/layout/StaticPageLayout';
import styles from '../privacy/page.module.css';

const SECTION_KEYS = ['what', 'who', 'verification', 'conduct', 'ourRights', 'liability', 'contact'] as const;

export default function TermsPage() {
  const t = useTranslations('terms');
  const tCommon = useTranslations('common');

  return (
    <StaticPageLayout
      footerLinks={[
        { href: '/privacy', label: t('footerPrivacy') },
        { href: '/contact', label: tCommon('contactLink') },
      ]}
    >
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.lastUpdated}>{t('lastUpdated')}</p>

      {SECTION_KEYS.map((key) => (
        <section key={key} className={styles.section}>
          <h2 className={styles.sectionTitle}>{t(`sections.${key}.title`)}</h2>
          <p className={styles.sectionBody}>{t(`sections.${key}.body`)}</p>
        </section>
      ))}
    </StaticPageLayout>
  );
}
