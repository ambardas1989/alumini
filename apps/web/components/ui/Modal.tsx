'use client';

import { useRef, type ReactNode } from 'react';
import { useFocusTrap } from '@/lib/useFocusTrap';
import styles from './Modal.module.css';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
}

/** Centered modal with a dark overlay — see lib/useFocusTrap.ts for the focus-trap/return-to-trigger behaviour. */
export function Modal({ title, children, onClose }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title" className={styles.title}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
