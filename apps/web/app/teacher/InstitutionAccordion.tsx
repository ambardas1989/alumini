'use client';

import { useState } from 'react';
import { institutionColor } from '@/lib/institutionColor';
import { useTranslations } from '@/lib/useTranslations';
import { ClassRow } from './ClassRow';
import type { InstitutionGroup } from './types';
import styles from './InstitutionAccordion.module.css';

const COLLAPSED_VISIBLE_COUNT = 5;

interface InstitutionAccordionProps {
  group: InstitutionGroup;
  defaultOpen?: boolean;
}

export function InstitutionAccordion({ group, defaultOpen = false }: InstitutionAccordionProps) {
  const t = useTranslations('teacherHome');
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);

  // Active classes surface first so a teacher's current-year classes never
  // get buried under older archived ones within the same school.
  const sorted = [...group.classes].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  const years = sorted.map((c) => c.batchYear);
  const yearRange =
    years.length === 0
      ? ''
      : Math.min(...years) === Math.max(...years)
        ? String(Math.min(...years))
        : `${Math.min(...years)}–${Math.max(...years)}`;

  const visible = showAll ? sorted : sorted.slice(0, COLLAPSED_VISIBLE_COUNT);
  const remaining = sorted.length - visible.length;

  return (
    <div className={styles.accordion}>
      <button
        type="button"
        className={styles.header}
        style={{ background: institutionColor(group.institution.id) }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.headerText}>
          <span className={styles.name}>{group.institution.name}</span>
          <span className={styles.sub}>
            {yearRange} · {t('classCount', { count: group.classes.length })}
          </span>
        </span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.body}>
          {visible.map((c) => (
            <ClassRow key={c.id} classroom={c} />
          ))}
          {remaining > 0 && (
            <button type="button" className={styles.showAll} onClick={() => setShowAll(true)}>
              {t('showAllClasses', { count: remaining })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
