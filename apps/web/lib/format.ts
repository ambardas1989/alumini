/**
 * Locale-aware number/date formatting via the Intl API — never hand-roll a
 * number or date format string.
 *
 * 'en-IN' formats numbers with the Indian numbering system (1,00,000 not
 * 100,000) — matches most of this app's initial user base. Switch to
 * 'en-US' for a global audience. The right long-term fix is storing each
 * user's locale preference on their profile and threading it through here
 * instead of the 'en-IN' default; profiles.locale doesn't exist yet in the
 * schema, so every call below defaults to 'en-IN' until it does.
 */

const DEFAULT_LOCALE = 'en-IN';

export function formatNumber(n: number, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatDate(
  date: string | Date,
  locale: string = DEFAULT_LOCALE,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...options,
  }).format(new Date(date));
}

/**
 * "3 minutes ago" / "in 2 hours" style formatting. Always uses the 'en'
 * locale for the *grammar* (RelativeTimeFormat has no en-IN variant — the
 * Indian-numbering distinction formatNumber()/formatDate() apply doesn't
 * exist for relative time), independent of which locale the caller passes
 * to the other two functions here.
 */
export function formatRelativeTime(date: string | Date): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diff = (new Date(date).getTime() - Date.now()) / 1000;
  if (Math.abs(diff) < 60) return rtf.format(Math.round(diff), 'second');
  if (Math.abs(diff) < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (Math.abs(diff) < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
