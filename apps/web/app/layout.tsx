import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { defaultLocale } from '@/i18n/config';
import { brand } from '@/lib/brand';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: brand.name,
  description: brand.tagline,
};

/**
 * Reads the manual theme override (if any) — or falls back to the OS
 * preference — and paints `data-theme` on <html> before React hydrates,
 * so there's no flash of the wrong theme. Must run synchronously in
 * <head>, not via next/script or a useEffect (both run too late — after
 * first paint). THEME_KEY here must match lib/useTheme.ts's THEME_KEY;
 * they can't literally share a constant since this has to be a static
 * string baked into the script tag, not a runtime import.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('alumini_theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const messages = await getMessages();

  return (
    <html lang="en" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={defaultLocale} messages={messages}>
          <ThemeProvider>
            <AuthProvider>
              <ToastProvider>{children}</ToastProvider>
            </AuthProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
