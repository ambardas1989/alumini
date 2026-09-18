/**
 * Thin re-export of next-intl's useTranslations — the single import path
 * components should use instead of importing 'next-intl' directly,
 * matching this app's "always go through lib/" convention (see
 * lib/brand.ts, lib/api.ts).
 *
 * Interpolation (`t('home.greeting', { name: 'Priya' })` filling a
 * `{name}` placeholder in the translation string) is next-intl's own
 * built-in ICU MessageFormat behaviour — it comes for free from the `t`
 * function below, nothing extra needed. Plurals work the same way, e.g.
 * i18n/messages/en.json's "session.expiringMessage":
 *   "{minutes, plural, one {# minute} other {# minutes}}"
 */
export { useTranslations } from 'next-intl';
