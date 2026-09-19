const createNextIntlPlugin = require('next-intl/plugin');

// Points at the i18n/request.ts created for Part 5 (localization) — required
// for next-intl to find its per-request config; without this wrapper,
// getRequestConfig()'s module is never picked up and next-intl throws at
// runtime ("Couldn't find next-intl config file").
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Node-hosted deploy (Render) rather than a serverless/edge platform —
  // standalone traces the exact runtime deps into .next/standalone so the
  // deployed footprint doesn't need the full monorepo node_modules.
  output: 'standalone',
  // packages/* ship raw .ts with no build step (same convention apps/backend
  // and apps/mobile rely on) — Next only runs its TS/JS loader over the app
  // directory and whatever's listed here, so workspace packages need to be
  // named explicitly or their .ts source never gets transpiled.
  transpilePackages: ['@alumini/config', '@alumini/types', '@alumini/utils'],

  // Image optimization — allow Supabase storage domain
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    // Modern formats for smaller files
    formats: ['image/avif', 'image/webp'],
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },

  // Redirects
  async redirects() {
    return [
      // Redirect root to login if not authenticated
      // (handled client-side in AuthProvider — not here)
    ];
  },
};

module.exports = withNextIntl(nextConfig);
