'use client';

import { useRef, type ReactNode } from 'react';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { useTranslations } from '@/lib/useTranslations';
import styles from './SheetModal.module.css';

interface SheetModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  rightAction?: ReactNode;
}

/**
 * Full-screen overlay on mobile, centered dialog (like Modal) from the
 * `lg` breakpoint up — used for the event-creation and member-list
 * modals, which the task specs as "full screen on mobile, centered on
 * desktop" rather than Modal's always-centered, always-compact dialog.
 */
export function SheetModal({ title, children, onClose, rightAction }: SheetModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('common');
  useFocusTrap(dialogRef, onClose);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label={t('close')}>
            ×
          </button>
          <h2 id="sheet-modal-title" className={styles.title}>
            {title}
          </h2>
          {rightAction && <div className={styles.rightAction}>{rightAction}</div>}
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
