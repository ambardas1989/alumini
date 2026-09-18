/**
 * Breakpoint scale and matching media-query strings. Mobile-first — every
 * numeric breakpoint is a min-width value, so styles are written for the
 * smallest screen first and layered on as the viewport grows.
 */

export const breakpoints = {
  // Mobile first — these are min-width values
  xs: 320, // Small phones (iPhone SE)
  sm: 375, // Standard phones (iPhone 14, Pixel 7)
  md: 428, // Large phones (iPhone 14 Pro Max)
  lg: 768, // Tablets portrait (iPad Mini, iPad Air)
  xl: 1024, // Tablets landscape + small laptops
  xxl: 1280, // Laptops and desktops
  xxxl: 1536, // Large desktops and 4K
} as const;

export type Breakpoint = keyof typeof breakpoints;

export const mediaQuery = {
  xs: `@media (min-width: ${breakpoints.xs}px)`,
  sm: `@media (min-width: ${breakpoints.sm}px)`,
  md: `@media (min-width: ${breakpoints.md}px)`,
  lg: `@media (min-width: ${breakpoints.lg}px)`,
  xl: `@media (min-width: ${breakpoints.xl}px)`,
  xxl: `@media (min-width: ${breakpoints.xxl}px)`,
  xxxl: `@media (min-width: ${breakpoints.xxxl}px)`,
  // Device-specific
  touch: `@media (hover: none) and (pointer: coarse)`,
  mouse: `@media (hover: hover) and (pointer: fine)`,
  retina: `@media (-webkit-min-device-pixel-ratio: 2)`,
  darkMode: `@media (prefers-color-scheme: dark)`,
  reducedMotion: `@media (prefers-reduced-motion: reduce)`,
  landscape: `@media (orientation: landscape)`,
  portrait: `@media (orientation: portrait)`,
} as const;
