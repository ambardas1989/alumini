'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PersonaType } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './page.module.css';

interface PersonaOption {
  type: PersonaType;
  icon: string;
  translationKey: 'alumni' | 'teacher' | 'school_admin';
  brandLineKey: 'alumni_line' | 'teacher_line' | 'school_admin_line';
}

const PERSONAS: PersonaOption[] = [
  { type: 'alumni', icon: '🎓', translationKey: 'alumni', brandLineKey: 'alumni_line' },
  { type: 'teacher', icon: '✏️', translationKey: 'teacher', brandLineKey: 'teacher_line' },
  { type: 'school_admin', icon: '🏫', translationKey: 'school_admin', brandLineKey: 'school_admin_line' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const t = useTranslations('onboarding');
  const tBrand = useTranslations('brand.onboarding');

  const [selected, setSelected] = useState<PersonaType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      if (selected === 'alumni') {
        // teacher/school_admin need an institutionId the backend requires
        // (AddPersonaDto) that this screen never collects — those two
        // create their persona further down their own flow, once an
        // institution is actually chosen (school_admin: app/onboarding/
        // claim/page.tsx; teacher: /teacher, out of this pass's scope).
        await api.addPersona('alumni');
      }

      if (selected === 'alumni') router.push('/');
      else if (selected === 'teacher') router.push('/teacher');
      else router.push('/onboarding/claim');
    } catch (err) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  };

  if (!ready) return null;

  return (
    <AppShell showNav={false}>
      <div className={styles.wrap}>
        <div className={styles.top}>
          <div className={styles.progressDots}>
            <span className={`${styles.dot} ${styles.dotActive}`} />
          </div>
          <h1 className={styles.title}>{t('title')}</h1>
          <p className={styles.subtitle}>{t('subtitle')}</p>
        </div>

        <div className={styles.cards}>
          {PERSONAS.map((persona) => {
            const isSelected = selected === persona.type;
            return (
              <button
                key={persona.type}
                type="button"
                className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                onClick={() => setSelected(persona.type)}
                aria-pressed={isSelected}
              >
                {isSelected && (
                  <span className={styles.checkBadge} aria-hidden="true">
                    ✓
                  </span>
                )}
                <span className={styles.cardIcon} aria-hidden="true">
                  {persona.icon}
                </span>
                <span className={styles.cardLabel}>{t(`${persona.translationKey}.label`)}</span>
                <span className={styles.cardDescription}>{t(`${persona.translationKey}.description`)}</span>
                {isSelected && (
                  <span className={styles.brandLine}>{tBrand(persona.brandLineKey)}</span>
                )}
              </button>
            );
          })}
        </div>

        {error && <ErrorMessage message={error} />}

        <Button variant="primary" size="lg" fullWidth disabled={!selected} loading={submitting} onClick={handleContinue}>
          {t('continueButton')}
        </Button>

        <p className={styles.skipLink}>
          <Link href="/">{t('skipLink')}</Link>
        </p>
      </div>
    </AppShell>
  );
}
