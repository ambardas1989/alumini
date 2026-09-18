'use client';

import type { ReactNode } from 'react';
import { useTheme } from '@/lib/useTheme';

/**
 * app/layout.tsx is a Server Component, so it can't call useTheme() itself
 * — this is the thin client wrapper that runs its mount-time sync
 * (resolving stored override vs. prefers-color-scheme, in case they've
 * diverged since the inline FOUC script ran) high in the tree, once.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useTheme();
  return <>{children}</>;
}
