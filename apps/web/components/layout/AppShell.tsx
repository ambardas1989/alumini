import type { ReactNode } from 'react';
import { BottomNav } from '../BottomNav';
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
}

/**
 * "Mobile app inside a browser" shell. Full width with a fixed bottom nav
 * on phones; centred at --app-max-width (480px) on tablets/desktop so the
 * app keeps its phone-shell feel rather than stretching edge-to-edge on a
 * wide monitor — see --app-max-width / --app-margin in globals.css.
 */
export function AppShell({ children, showNav = true }: AppShellProps) {
  return (
    <div className="app-shell">
      <main className="app-content">{children}</main>
      {showNav && <BottomNav />}
    </div>
  );
}
