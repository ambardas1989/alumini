'use client';

/**
 * Decorative wordmark: "AlumTrib" in serif, plus a small graduation cap
 * sitting on top of the final "e". This is a one-off brand graphic, not a
 * generic label — it hardcodes the "AlumTrib" / "e" split rather than
 * deriving it from brand.ts's `name`. If the brand name ever changes from
 * "AlumTribe", this split (and the whole point of the cap-on-the-e motif)
 * needs to be redesigned, not just re-parameterized.
 *
 * Inline styles rather than a CSS Module: the SVG cap's geometry (cx,
 * brimY, capBodyW, ...) is computed from the `size` prop and has to be
 * threaded into the SVG's own coordinate system either way, so the text
 * styling is kept alongside it for one legible component instead of split
 * across a .tsx file and a .module.css file that would need matching
 * numbers kept in sync by hand.
 */

export type WordmarkSize = 'sm' | 'md' | 'lg' | 'xl';
export type WordmarkVariant = 'light' | 'dark';

interface WordmarkProps {
  size?: WordmarkSize;
  /** Which background this sits on — 'dark' (a dark purple panel, e.g. AuthLayout's left panel) gets white text; 'light' (the default cream/white background) gets the purple brand color. */
  variant?: WordmarkVariant;
}

const sizes: Record<WordmarkSize, { fontSize: number; capWidth: number; capBottom: number; tasselHeight: number }> = {
  sm: { fontSize: 24, capWidth: 20, capBottom: 2, tasselHeight: 18 },
  md: { fontSize: 32, capWidth: 26, capBottom: 3, tasselHeight: 24 },
  lg: { fontSize: 48, capWidth: 38, capBottom: 4, tasselHeight: 36 },
  xl: { fontSize: 64, capWidth: 50, capBottom: 5, tasselHeight: 48 },
};

export default function Wordmark({ size = 'md', variant = 'light' }: WordmarkProps) {
  const { fontSize, capWidth, capBottom, tasselHeight } = sizes[size];
  // var(--color-primary) is this app's established brand-purple token
  // (app/globals.css); the cap's gold tones are a new, one-off decorative
  // color with no existing token, so those stay literal.
  const textColor = variant === 'dark' ? '#ffffff' : 'var(--color-primary)';
  const capColor = variant === 'dark' ? '#C4920A' : '#9A6B00';
  const capDark = variant === 'dark' ? '#9A6B00' : '#7A5200';
  const capHeight = capWidth * 0.55;

  const cx = (capWidth + 12) / 2;
  const brimY = capHeight * 0.5;
  const topY = 2;
  const boardW = capWidth;
  const brimH = capHeight * 0.18;
  const capBodyH = capHeight * 0.38;
  const capBodyW = capWidth * 0.52;
  const baseH = capHeight * 0.16;
  const baseW = capWidth * 0.72;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      <span
        style={{
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize,
          fontWeight: 700,
          color: textColor,
          letterSpacing: '0.02em',
          lineHeight: 1,
        }}
      >
        AlumTrib
      </span>

      <span style={{ position: 'relative', lineHeight: 1 }}>
        <span
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize,
            fontWeight: 700,
            color: textColor,
            letterSpacing: '0.02em',
            lineHeight: 1,
          }}
        >
          e
        </span>

        <svg
          width={capWidth + 12}
          height={capHeight + tasselHeight}
          viewBox={`0 0 ${capWidth + 12} ${capHeight + tasselHeight}`}
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: `calc(100% - ${capBottom}px)`,
            overflow: 'visible',
          }}
          aria-hidden="true"
        >
          <polygon
            points={`${cx},${topY} ${cx - boardW / 2},${brimY} ${cx},${brimY + capHeight * 0.42 * 0.5} ${cx + boardW / 2},${brimY}`}
            fill={capColor}
            stroke={capDark}
            strokeWidth="0.5"
          />
          <rect x={cx - boardW / 2} y={brimY} width={boardW} height={brimH} rx={brimH / 2} fill={capDark} />
          <rect
            x={cx - capBodyW / 2}
            y={brimY + brimH}
            width={capBodyW}
            height={capBodyH}
            rx={3}
            fill={capColor}
          />
          <rect
            x={cx - baseW / 2}
            y={brimY + brimH + capBodyH}
            width={baseW}
            height={baseH}
            rx={baseH / 2}
            fill={capColor}
          />
          <line
            x1={cx + boardW / 2}
            y1={brimY}
            x2={cx + boardW / 2}
            y2={brimY + tasselHeight * 0.72}
            stroke={capColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line
            x1={cx + boardW / 2}
            y1={brimY + tasselHeight * 0.72}
            x2={cx + boardW / 2 - 5}
            y2={brimY + tasselHeight * 0.92}
            stroke={capColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx={cx + boardW / 2 - 5} cy={brimY + tasselHeight * 0.92} r={3} fill={capDark} />
        </svg>
      </span>
    </span>
  );
}
