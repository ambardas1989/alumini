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

/**
 * FIX 2 — the previous formatDate()/formatRelativeTime() had no guard
 * against a null/undefined/unparseable date string: `new Date(undefined)`
 * is an Invalid Date, and both `Intl.DateTimeFormat.format()` and
 * `Intl.RelativeTimeFormat.format()` throw on one (TypeError: Invalid
 * option : option / RangeError: Value need to be finite number) instead of
 * returning a fallback string — which crashed every render site that ever
 * received a missing/malformed timestamp from the API. safeFormatDate()/
 * safeRelativeTime() replace them everywhere in this app: every path
 * (missing input, unparseable input, and even a thrown Intl call) returns
 * a plain string instead of throwing.
 */
export function safeFormatDate(
  date: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  if (!date) return 'Unknown';
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return 'Unknown';
  try {
    return new Intl.DateTimeFormat('en-IN', options).format(parsed);
  } catch {
    return 'Unknown';
  }
}

export function safeRelativeTime(date: string | null | undefined): string {
  if (!date) return 'just now';
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return 'just now';
  const diff = Date.now() - parsed.getTime();
  if (!isFinite(diff)) return 'just now';
  try {
    const seconds = Math.floor(Math.abs(diff) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return safeFormatDate(date, { day: 'numeric', month: 'short' });
  } catch {
    return 'just now';
  }
}
