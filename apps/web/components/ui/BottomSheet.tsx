'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useFocusTrap } from '@/lib/useFocusTrap';
import styles from './BottomSheet.module.css';

interface BottomSheetProps {
  children: ReactNode;
  onClose: () => void;
}

const DISMISS_THRESHOLD_PX = 80;

/** Slides up from the bottom; drag the handle down (past DISMISS_THRESHOLD_PX) or tap the overlay to dismiss. */
export function BottomSheet({ children, onClose }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, onClose);

  const [dragOffset, setDragOffset] = useState(0);
  const dragStartY = useRef<number | null>(null);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    if (delta > 0) setDragOffset(delta);
  };

  const handlePointerUp = () => {
    if (dragOffset > DISMISS_THRESHOLD_PX) {
      onClose();
    } else {
      setDragOffset(0);
    }
    dragStartY.current = null;
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{ transform: dragOffset ? `translateY(${dragOffset}px)` : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={styles.handleArea}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <span className={styles.handle} />
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
