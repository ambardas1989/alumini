'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './providers/AuthProvider';
import { useTranslations } from '@/lib/useTranslations';
import { Avatar } from './ui/Avatar';
import styles from './UserMenu.module.css';

/**
 * Avatar button + dropdown (View profile, Help & Support, Sign out) —
 * shared by every top bar that shows the current user's avatar (home,
 * teacher home; wire into any future one the same way). Not built into
 * AppShell itself — AppShell renders no header content of its own by
 * design (see its own doc comment: every screen's header differs too much
 * to templatize there), and every screen that has an avatar already builds
 * its own top bar locally, so this slots into that existing per-page
 * pattern instead of fighting it.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const t = useTranslations('userMenu');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-label={t('menuLabel')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar avatarUrl={user?.avatarUrl} fullName={user?.fullName ?? ''} size="sm" />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <Link href="/profile" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
            {t('viewProfile')}
          </Link>
          {/* Preserves what clicking the avatar used to do before this menu
              replaced a plain avatar-links-to-/persona pattern on the pages
              that use this component. */}
          <Link href="/persona" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
            {t('switchPersona')}
          </Link>
          {/* /contact doesn't exist yet as of this task — links here
              correctly once that page ships. */}
          <Link href="/contact" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
            {t('helpSupport')}
          </Link>
          <div className={styles.divider} role="separator" />
          <button type="button" className={`${styles.item} ${styles.destructive}`} role="menuitem" onClick={logout}>
            {t('signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
