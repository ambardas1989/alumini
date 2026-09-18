/**
 * Spacing scale based on a 4px base unit. All values are divisible by 4 so
 * they render pixel-perfect across every screen density (1x, 2x, 3x
 * retina) — a non-multiple-of-4 value can land on a sub-pixel boundary and
 * blur or round inconsistently between browsers.
 *
 * These are TS constants (not CSS custom properties) for use in inline
 * styles / JS-computed layout. Static per-component CSS should keep using
 * the --spacing-* custom properties / literal px values already in
 * globals.css and each component's own stylesheet.
 */

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;

export type SpacingKey = keyof typeof spacing;

/**
 * Minimum touch target size — Apple HIG recommends 44px, Material Design
 * recommends 48px. 44px is the floor used across this codebase; see
 * apps/web/styles/components.css for where it's applied globally.
 */
export const MIN_TOUCH_TARGET = '44px';
