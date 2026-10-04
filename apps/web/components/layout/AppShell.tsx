'use client';

import type { ReactNode } from 'react';
import { BottomNav } from '../BottomNav';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useIdleTimeout } from '@/lib/useIdleTimeout';
import { useTranslations } from '@/lib/useTranslations';
import '@/styles/layout.css';

interface AppShellProps {
  children: ReactNode;
  showNav?: boolean;
  /**
   * Accepted for API symmetry with screens that render their own
   * PageHeader — AppShell doesn't render a header itself (every screen's
   * header content differs too much to templatize here) or apply any
   * layout change based on this flag today. Kept as an explicit prop so
   * call sites can state their intent now without a breaking change later
   * if AppShell ever does need to react to it.
   */
  showHeader?: boolean;
  /**
   * TASKS_10 TASK 08 — for a screen whose own content must scroll
   * internally (e.g. a chat view's message list) instead of the page
   * scrolling. See app-shell--fixed-height/app-content--flex in
   * styles/layout.css for why this is opt-in rather than the default.
   */
  fixedHeight?: boolean;
}

/**
 * "Mobile app inside a browser" shell. Full width with a fixed bottom nav
 * on phones; centred at --app-max-width (480px) on tablets/desktop so the
 * app keeps its phone-shell feel rather than stretching edge-to-edge on a
 * wide monitor — see --app-max-width / --app-margin in globals.css.
 */
export function AppShell({ children, showNav = true, fixedHeight = false }: AppShellProps) {
  const t = useTranslations('common.idleTimeout');
  const { showWarning, warningSecondsLeft, staySignedIn, signOutNow } = useIdleTimeout();

  return (
    <div className={`app-shell ${fixedHeight ? 'app-shell--fixed-height' : ''}`}>
      <main className={`app-content ${fixedHeight ? 'app-content--flex' : ''}`}>{children}</main>
      {showNav && <BottomNav />}

      {showWarning && (
        <Modal title={t('title')} onClose={staySignedIn}>
          <p>{t('message', { seconds: warningSecondsLeft })}</p>
          <div className="idle-timeout-actions">
            <Button variant="ghost" size="md" onClick={signOutNow}>
              {t('signOutButton')}
            </Button>
            <Button variant="primary" size="md" onClick={staySignedIn}>
              {t('stayButton')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
