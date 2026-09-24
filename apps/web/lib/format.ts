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

/**
 * TASKS_05 TASK 02 — profiles.phone is stored in E.164 (enforced by
 * UpdateProfileDto's regex: '+' + country code + national number, no
 * spaces). This is a display-only, best-effort grouping — not a precise
 * per-country formatter (that needs a library like libphonenumber, which
 * isn't a dependency of this app) — it assumes a 2-digit country code and
 * groups the rest in fives, matching the "+91 98765 43210" example this
 * app's own mockups use. Numbers with a different country-code length will
 * still display correctly as digits, just not grouped exactly right.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/^\+/, '');
  if (digits.length <= 4) return phone;
  const countryCode = digits.slice(0, 2);
  const rest = digits.slice(2);
  const groups = rest.match(/.{1,5}/g) ?? [rest];
  return `+${countryCode} ${groups.join(' ')}`;
}

/**
 * TASKS_07 TASK 09 FIX B — allows only characters a phone number could
 * legitimately contain while typing (digits, +, spaces, hyphens,
 * parentheses); doesn't restructure the value or move the cursor, so it's
 * safe to run on every keystroke without fighting mid-edit typing.
 */
export function sanitizePhoneInput(value: string): string {
  return value.replace(/[^\d+\s\-()]/g, '');
}

/**
 * TASKS_07 TASK 09 FIX B/D — best-effort normalization toward E.164,
 * mirroring apps/backend's normalizePhone() (UpdateProfileDto) exactly so
 * the value shown here after blur is the same one the API will accept.
 * Run on blur, not on every keystroke — restructuring the value while the
 * user is still typing the country code would fight their cursor.
 */
export function normalizePhoneForSubmit(value: string): string {
  const stripped = value.replace(/[\s\-()]/g, '');
  if (!stripped || stripped.startsWith('+')) return stripped;
  if (/^0\d{10}$/.test(stripped)) return `+91${stripped.slice(1)}`;
  if (/^\d{10}$/.test(stripped)) return `+91${stripped}`;
  if (/^\d+$/.test(stripped)) return `+${stripped}`;
  return stripped;
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
