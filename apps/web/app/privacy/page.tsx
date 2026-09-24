'use client';

import { useTranslations } from '@/lib/useTranslations';
import { StaticPageLayout } from '@/components/layout/StaticPageLayout';
import styles from './page.module.css';

const SECTION_KEYS = ['collect', 'use', 'never', 'protect', 'retention', 'rights', 'contact'] as const;

export default function PrivacyPage() {
  const t = useTranslations('privacy');
  const tCommon = useTranslations('common');

  return (
    <StaticPageLayout
      footerLinks={[
        { href: '/terms', label: t('footerTerms') },
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
