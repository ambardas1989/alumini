/**
 * Single entry point for packages/config in this app.
 *
 * Page and component code should import brand/appConfig from here, never
 * directly from '@alumini/config/*' — keeps every web usage swappable from
 * one place if the config package's shape ever changes.
 */

export { brand } from '@alumini/config/brand';
export type { Brand, BrandColors } from '@alumini/config/brand';

export { appConfig } from '@alumini/config/app';
export type { AppConfig } from '@alumini/config/app';
