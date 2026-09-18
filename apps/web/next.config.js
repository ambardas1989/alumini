/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/* ship raw .ts with no build step (same convention apps/backend
  // and apps/mobile rely on) — Next only runs its TS/JS loader over the app
  // directory and whatever's listed here, so workspace packages need to be
  // named explicitly or their .ts source never gets transpiled.
  transpilePackages: ['@alumini/config', '@alumini/types', '@alumini/utils'],
};

module.exports = nextConfig;
