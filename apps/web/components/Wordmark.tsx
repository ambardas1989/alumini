'use client';

/**
 * Plain serif wordmark — no cap, no SVG, no positioning tricks. An earlier
 * pass added a graduation-cap SVG sitting on the final "e", but it rendered
 * misaligned in production (floating over the wrong letter) — removed
 * rather than patched. The cap concept is reserved for when a professional
 * designer can implement it properly in Figma.
 */

export type WordmarkSize = 'sm' | 'md' | 'lg' | 'xl';
export type WordmarkVariant = 'light' | 'dark';

interface WordmarkProps {
  size?: WordmarkSize;
  /** Which background this sits on — 'dark' (a dark purple panel, e.g. AuthLayout's left panel) gets white text; 'light' (the default cream/white background) gets the purple brand color. */
  variant?: WordmarkVariant;
}

const sizes: Record<WordmarkSize, number> = {
  sm: 20,
  md: 28,
  lg: 40,
  xl: 56,
};

export default function Wordmark({ size = 'md', variant = 'light' }: WordmarkProps) {
  const fontSize = sizes[size];
  // var(--color-primary) is this app's established brand-purple token
  // (app/globals.css) — used instead of a literal hex for the 'light' case.
  const color = variant === 'dark' ? '#ffffff' : 'var(--color-primary)';

  return (
    <span
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize,
        fontWeight: 700,
        color,
        letterSpacing: '0.01em',
        lineHeight: 1,
        userSelect: 'none',
        display: 'inline-block',
      }}
    >
      AlumTribe
    </span>
  );
}
