'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Traps Tab focus inside `containerRef` while `active`, closes on Escape,
 * and returns focus to whatever triggered the overlay when it closes.
 * Shared by every modal/sheet in this app (see components/ui/Modal.tsx,
 * BottomSheet.tsx, SheetModal.tsx) so the accessibility behaviour — "focus
 * returns to trigger after modal closes" — only has one implementation.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;

    const trigger = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !containerRef.current) return;

      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      trigger?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
