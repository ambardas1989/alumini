'use client';

import { useRef, type ReactNode } from 'react';
import type { MethodStatus } from './types';
import styles from './MethodAccordion.module.css';

interface MethodAccordionProps {
  number: number;
  title: string;
  status: MethodStatus;
  /** Right-aligned header extra, e.g. "2 / 3 pts" for peer vouching. */
  headerExtra?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * One method's card: header row (always visible, full tap target) plus
 * expanded content animated via CSS max-height (respects prefers-reduced-
 * motion through the global animation-duration override in
 * app/globals.css, same as every other transition in this app).
 */
export function MethodAccordion({ number, title, status, headerExtra, expanded, onToggle, children }: MethodAccordionProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.header}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`${styles.numberBadge} ${status === 'complete' ? styles.numberBadgeComplete : ''}`}>
          {status === 'complete' ? '✓' : number}
        </span>
        <span className={styles.title}>{title}</span>
        {headerExtra && <span className={styles.headerExtra}>{headerExtra}</span>}
        {status === 'inProgress' && !headerExtra && <span className={styles.statusDot} aria-hidden="true" />}
      </button>
      <div
        ref={contentRef}
        className={styles.content}
        style={{ maxHeight: expanded ? contentRef.current?.scrollHeight ?? 2000 : 0 }}
      >
        <div className={styles.contentInner}>{children}</div>
      </div>
    </div>
  );
}
