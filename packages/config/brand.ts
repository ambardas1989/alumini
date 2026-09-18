/**
 * Brand configuration — single source of truth for all brand values.
 *
 * HOW TO REBRAND:
 *   1. Change `name`, `tagline`, `domain` below.
 *   2. Update `colors.primary` and dark mode equivalents if needed.
 *   3. Update `fonts.primary` if switching typeface.
 *   All apps (web, mobile, backend email templates) read from here.
 *
 * NOTE: This file is imported by all three apps via the packages/config
 * workspace package. Do not duplicate values elsewhere.
 */

export const brand = {
  // ── Identity ────────────────────────────────────────────────────────────
  /** Display name shown in UI, emails, app store listings */
  name: 'AlumTribe',

  /** Short tagline shown on splash screen and marketing */
  tagline: 'Some bonds never graduate.',

  /** Secondary line — shown alongside tagline on first-impression moments (e.g. signup) */
  subline: 'Find your batch. Stay connected forever.',

  /** Primary domain — used for deep links, OAuth callbacks, email from-address */
  domain: 'alumtribe.com',

  /** Support email */
  supportEmail: 'hello@alumtribe.com',

  /** Legal entity name (for Terms of Service, Privacy Policy) */
  legalName: 'Alumini Technologies Pvt. Ltd.',

  /**
   * Persona-specific brand lines — shown once, right after a user picks
   * that persona during onboarding (or as a reminder in the persona
   * switcher). Deliberately not reused as generic taglines elsewhere —
   * each is written to land as a personal, in-the-moment affirmation, not
   * marketing copy.
   */
  onboardingLines: {
    alumni: 'Your batch. Forever.',
    teacher: 'Your tribe is here.',
    school_admin: 'Their journey started with you.',
  },

  // ── Colours (light mode) ────────────────────────────────────────────────
  colors: {
    /** Primary accent — Midnight Purple */
    primary:      '#4A1FA8',
    primaryLight: '#EAE4FF',
    primaryMid:   '#7A55D8',
    primaryDark:  '#2A0F7A',

    /** Page background */
    background:   '#F0ECFF',

    /** Card / surface background */
    surface:      '#FFFFFF',
    cream:        '#F8F5FF',

    /** Borders */
    border:       '#DDD5F8',
    borderStrong: '#A590E8',

    /** Text */
    textPrimary:  '#12063A',
    textSecondary:'#3B2870',
    textMuted:    '#7A62B8',
    textFaint:    '#A590E8',

    /** Semantic */
    success:      '#16A34A',
    successLight: '#DCFCE7',
    warning:      '#D97706',
    warningLight: '#FEF3C7',
    info:         '#2563EB',
    infoLight:    '#DBEAFE',
    error:        '#DC2626',
    errorLight:   '#FEE2E2',

    // ── Dark mode overrides ───────────────────────────────────────────────
    dark: {
      primary:      '#9D7FF5',
      primaryLight: '#3D3280',
      background:   '#1E1646',
      surface:      '#2E2468',
      cream:        '#261D58',
      border:       '#3D3280',
      borderStrong: '#5A4AAA',
      textPrimary:  '#EDE8FF',
      textSecondary:'#C4B8F0',
      textMuted:    '#9080C8',
      textFaint:    '#5A4AAA',
      success:      '#34D578',
      successLight: '#0D3A20',
      /** Muted dusty gold — NOT bright amber — on dark purple background */
      warning:      '#C49A3C',
      warningLight: '#2A2010',
      info:         '#7DB8FA',
      infoLight:    '#1A305A',
      /** Softened red — the light-mode #DC2626 reads too harsh against a dark purple background */
      error:        '#EF5350',
      errorLight:   '#3A1515',
    },
  },

  // ── Typography ──────────────────────────────────────────────────────────
  fonts: {
    /** Primary typeface — loaded from Google Fonts */
    primary: 'Outfit',

    /** Font weights used in the design system */
    weights: {
      regular:  '400',
      medium:   '500',
      semibold: '600',
      bold:     '700',
      extrabold:'800',
    },

    /** Google Fonts URL for web / Next.js */
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap',
  },

  // ── Channel names ────────────────────────────────────────────────────────
  /**
   * The three channels inside each classroom.
   * Changing these renames them everywhere in the UI.
   */
  channels: {
    /** Main channel — all verified members (students + teachers) */
    main:    'Classroom',

    /** Faculty-only channel — completely hidden from students */
    staff:   'Staff Room',

    /** Students-only channel — teachers cannot read or post */
    student: 'Student Alley',
  },
} as const;

export type Brand = typeof brand;
export type BrandColors = typeof brand.colors;
