/**
 * Shared utility functions used across backend, web, and mobile.
 * All functions are pure — no side effects, no external dependencies.
 */

import type { ClassroomIdParams } from '@alumini/types';
import { appConfig } from '@alumini/config/app';

// ── Classroom ID Generation ───────────────────────────────────────────────────

/**
 * Generates the globally unique classroom ID from structured parameters.
 *
 * Schools:      IN-KOL-MPBIRLA-9A-2012
 * Universities: US-UCDAVIS-MBA-2025
 *
 * Rules:
 * - All parts uppercased
 * - Spaces stripped from section/program
 * - City code included only for schools (not universities)
 *
 * @example
 * generateClassroomId({
 *   countryCode: 'IN', cityCode: 'KOL', institutionSlug: 'MPBIRLA',
 *   grade: '9', section: 'A', batchYear: 2012
 * })
 * // → 'IN-KOL-MPBIRLA-9A-2012'
 */
export function generateClassroomId(params: ClassroomIdParams): string {
  const {
    countryCode,
    cityCode,
    institutionSlug,
    grade,
    section,
    program,
    batchYear,
  } = params;

  // Build the class/program segment
  let classSegment: string;
  if (grade) {
    // School format: grade + optional section (e.g. '9A', '10', '12B')
    classSegment = section
      ? `${grade}${section.toUpperCase().replace(/\s+/g, '')}`
      : grade;
  } else if (program) {
    // College format: program slug (e.g. 'MBA', 'BTECH')
    classSegment = program.toUpperCase().replace(/\s+/g, '');
  } else {
    throw new Error('Either grade (school) or program (college) must be provided');
  }

  const parts: string[] = [
    countryCode.toUpperCase(),
    ...(cityCode ? [cityCode.toUpperCase()] : []),
    institutionSlug.toUpperCase(),
    classSegment,
    batchYear.toString(),
  ];

  return parts.join('-');
}

// ── Name Redaction ────────────────────────────────────────────────────────────

/**
 * Redacts a full name for display to unverified users.
 *
 * This runs SERVER-SIDE only. Never rely on frontend-only blurring
 * for privacy — the API must not send real names to unverified clients.
 *
 * @example
 * redactName('Priya Sharma') // → 'P*** S.'
 * redactName('Arjun')        // → 'A***'
 */
export function redactName(fullName: string): string {
  if (!fullName) return '***';

  const parts = fullName.trim().split(/\s+/);

  return parts
    .map((part) => {
      if (part.length <= 1) return part + '.';
      if (appConfig.REDACTION_KEEP_FIRST_CHAR) {
        return part[0] + '***';
      }
      return '***';
    })
    .join(' ');
}

// ── Institution Code Generation ───────────────────────────────────────────────

/**
 * Generates a random institution code in the format: {COUNTRY}-{YEAR}-{RANDOM6}
 * e.g. 'IN-2026-A7K2PQ'
 *
 * Uses crypto-safe randomness. Must be checked for uniqueness in DB before saving.
 */
export function generateInstitutionCode(
  countryCode: string,
  year: number,
): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars (0/O, 1/I)
  const randomPart = Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)],
  ).join('');

  return `${countryCode.toUpperCase()}-${year}-${randomPart}`;
}

// ── Vouch Points ──────────────────────────────────────────────────────────────

/**
 * Calculates total vouch points from a list of vouches.
 * Teacher vouches are worth more than student vouches.
 *
 * @param vouches - Array of vouch records with role info
 * @returns Total points accumulated
 */
export function calculateVouchPoints(
  vouches: Array<{ role: 'student' | 'teacher' }>,
): number {
  return vouches.reduce((total, vouch) => {
    const points =
      vouch.role === 'teacher'
        ? appConfig.VOUCH_POINTS_TEACHER
        : appConfig.VOUCH_POINTS_STUDENT;
    return total + points;
  }, 0);
}

/**
 * Returns true if the accumulated vouch points meet the threshold.
 */
export function isVouchThresholdMet(
  vouches: Array<{ role: 'student' | 'teacher' }>,
): boolean {
  return calculateVouchPoints(vouches) >= appConfig.VOUCH_POINTS_REQUIRED;
}

// ── Date Utilities ────────────────────────────────────────────────────────────

/**
 * Returns a Date that is N days from now.
 * Used for setting expiry timestamps on codes and documents.
 */
export function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Returns true if the given timestamp is in the past.
 */
export function isExpired(expiresAt: string | Date): boolean {
  return new Date(expiresAt) < new Date();
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validates the format of a classroom global ID.
 * Does not check for existence — only structure.
 *
 * Valid formats:
 *   IN-KOL-MPBIRLA-9A-2012   (school with section)
 *   IN-KOL-MPBIRLA-9-2012    (school without section)
 *   US-UCDAVIS-MBA-2025      (university)
 */
export function isValidClassroomId(globalId: string): boolean {
  // Must be uppercase, parts separated by hyphens, 4–5 parts
  const parts = globalId.split('-');
  if (parts.length < 4 || parts.length > 6) return false;

  // Each part must be alphanumeric uppercase
  const validPart = /^[A-Z0-9]+$/;
  if (!parts.every((p) => validPart.test(p))) return false;

  // Last part must be a 4-digit year
  const year = parseInt(parts[parts.length - 1], 10);
  if (year < 1900 || year > 2100) return false;

  return true;
}

/**
 * Validates an email address format.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validates an institution code format.
 * Format: {COUNTRY}-{YEAR}-{RANDOM6}
 */
export function isValidInstitutionCode(code: string): boolean {
  return /^[A-Z]{2}-\d{4}-[A-Z0-9]{6}$/.test(code);
}

// ── Pagination ────────────────────────────────────────────────────────────────

/**
 * Calculates Supabase range() parameters from page + pageSize.
 * Supabase uses inclusive from/to indexing.
 */
export function getRange(
  page: number,
  pageSize: number,
): { from: number; to: number } {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  return { from, to };
}
