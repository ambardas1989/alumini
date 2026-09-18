'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/** Kept in sync with the inline FOUC-prevention script in app/layout.tsx — see the comment there. */
const THEME_KEY = 'alumini_theme';

function applyThemeToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

function readSystemPreference(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Not context-backed — each call reads/writes the same localStorage key
 * and the same `data-theme` DOM attribute directly, so independent
 * components calling this hook stay in sync with each other without
 * needing a shared provider (multiple simultaneous consumers just means
 * multiple components independently agreeing on the same source of
 * truth). If this app ends up with many simultaneous theme-aware
 * components re-rendering on every toggle, revisit as a Context.
 */
export function useTheme() {
  // 'light' matches the SSR-rendered default (no window/localStorage there)
  // — corrected on mount below to whatever the inline script already
  // painted, so this never causes a visible flash on its own.
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    // The inline script in app/layout.tsx already set data-theme on <html>
    // before hydration — read it back rather than re-deriving, so this
    // hook's state matches what's already painted on screen.
    const painted = document.documentElement.getAttribute('data-theme');
    const stored = window.localStorage.getItem(THEME_KEY);
    const resolved: Theme =
      painted === 'dark' || painted === 'light'
        ? painted
        : stored === 'dark' || stored === 'light'
          ? stored
          : readSystemPreference();

    setThemeState(resolved);
    applyThemeToDocument(resolved);

    // Track OS-level changes live, but only for users who haven't set an
    // explicit manual override — a stored preference always wins.
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (e: MediaQueryListEvent) => {
      if (window.localStorage.getItem(THEME_KEY)) return;
      const next: Theme = e.matches ? 'dark' : 'light';
      setThemeState(next);
      applyThemeToDocument(next);
    };
    mql.addEventListener('change', handleSystemChange);
    return () => mql.removeEventListener('change', handleSystemChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyThemeToDocument(next);
    window.localStorage.setItem(THEME_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyThemeToDocument(next);
      window.localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggleTheme, setTheme };
}
