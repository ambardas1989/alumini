import { getRequestConfig } from 'next-intl/server';

/**
 * Single hardcoded locale for now — no [locale] route segment, no
 * middleware, no cookie/header negotiation. When a second locale ships,
 * this is the one place that needs to start resolving `locale` per-request
 * (e.g. from a route param or the user's stored preference) instead of the
 * literal 'en' below.
 */
export default getRequestConfig(async () => ({
  locale: 'en',
  messages: (await import('./messages/en.json')).default,
}));
