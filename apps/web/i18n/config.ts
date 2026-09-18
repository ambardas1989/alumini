/**
 * Locale registry. English is the only shipped locale at launch — this
 * file (plus a new apps/web/i18n/messages/<locale>.json) is the only thing
 * that needs to change to add another: no component imports a locale list
 * or a message file directly, they all go through useTranslations()
 * (apps/web/lib/useTranslations.ts) and next-intl's own provider, which
 * read from this config.
 */

export const locales = ['en'] as const;
export const defaultLocale = 'en' as const;
export type Locale = (typeof locales)[number];

// Future locales — add here when ready:
// 'hi' Hindi
// 'ta' Tamil
// 'bn' Bengali
// 'te' Telugu
// 'mr' Marathi
// 'gu' Gujarati
// 'kn' Kannada
// 'ml' Malayalam
// 'pa' Punjabi
// Ready for global: 'ar' 'zh' 'es' 'pt' 'fr'
//
// NOTE: 'ar' (Arabic) is RTL — see the "Logical CSS properties" comment
// at the top of app/globals.css for what else that needs (just
// html[dir="rtl"], no component changes, per that comment).
