/**
 * Application configuration — all tunable parameters in one place.
 *
 * Each value has a description explaining what it controls.
 * Change values here to affect behaviour across all services.
 *
 * NOTE: Sensitive values (API keys, secrets) must stay in .env files.
 *       Only non-sensitive defaults belong here.
 */

export const appConfig = {

  // ── Verification ─────────────────────────────────────────────────────────

  /** Total vouch points required to become verified */
  VOUCH_POINTS_REQUIRED: 3,

  /** Points awarded when a verified student vouches for someone */
  VOUCH_POINTS_STUDENT: 1,

  /**
   * Points awarded when a verified teacher vouches for someone.
   * Set to 1.5 so 2 teachers alone = 3pts = verified.
   */
  VOUCH_POINTS_TEACHER: 1.5,

  /**
   * Days before a verification document is auto-deleted from storage.
   * Privacy by design — documents are never stored long-term.
   */
  DOCUMENT_EXPIRY_DAYS: 30,

  /**
   * Days before an institution code expires.
   * Applies to both personal and batch codes.
   */
  CODE_EXPIRY_DAYS: 90,

  /**
   * Number of student vouches needed for a teacher to become verified.
   * Must come from students in that specific classroom.
   */
  TEACHER_STUDENT_VOUCHES_REQUIRED: 5,

  // ── Institution Admin ─────────────────────────────────────────────────────

  /**
   * Maximum number of admins per institution.
   * Includes the primary admin. Hard cap enforced in code and DB constraint.
   */
  INSTITUTION_MAX_ADMINS: 5,

  /**
   * Hours before an admin invitation link expires.
   * Co-admin invitations are sent via email with a magic link.
   */
  ADMIN_INVITE_EXPIRY_HOURS: 48,

  // ── Sessions & Auth ───────────────────────────────────────────────────────

  /** Maximum concurrent sessions (devices) per user account */
  SESSION_MAX_DEVICES: 5,

  /** JWT access token expiry in days */
  JWT_EXPIRY_DAYS: 7,

  /**
   * Whether MFA is mandatory for all users.
   * Set to false only for development/testing. Always true in production.
   */
  MFA_REQUIRED: true,

  /**
   * Whether school admins must use TOTP (not SMS).
   * SMS is considered less secure — admins handle sensitive operations.
   */
  ADMIN_MFA_TOTP_ONLY: true,

  // ── Rate Limiting ─────────────────────────────────────────────────────────

  /** Max login attempts per minute per IP before lockout */
  RATE_LIMIT_LOGIN_PER_MIN: 5,

  /** Max MFA verification attempts per minute per user */
  RATE_LIMIT_MFA_PER_MIN: 3,

  /** Max institutional email verification requests per hour per user */
  RATE_LIMIT_VERIFY_EMAIL_PER_HOUR: 3,

  /** Max document verification submissions per day per user */
  RATE_LIMIT_VERIFY_DOC_PER_DAY: 3,

  /** Max code generation requests per minute per admin */
  RATE_LIMIT_CODES_PER_MIN: 10,

  /** Max bulk import operations per hour per admin */
  RATE_LIMIT_IMPORT_PER_HOUR: 1,

  // ── Storage ───────────────────────────────────────────────────────────────

  /** Free tier storage limit per classroom in megabytes */
  STORAGE_FREE_MB: 200,

  /** Premium tier storage limit per classroom in megabytes */
  STORAGE_PREMIUM_MB: 2048,

  /** Max attachment size for free users in megabytes */
  ATTACHMENT_FREE_MAX_MB: 5,

  /** Max attachment size for premium users in megabytes */
  ATTACHMENT_PREMIUM_MAX_MB: 25,

  // ── Premium ───────────────────────────────────────────────────────────────

  /** Monthly premium subscription price in Indian Rupees */
  PREMIUM_PRICE_INR: 99,

  /** Monthly premium subscription price in US Dollars */
  PREMIUM_PRICE_USD: 2,

  // ── Pagination ────────────────────────────────────────────────────────────

  /** Number of messages returned per page in chat */
  MESSAGES_PAGE_SIZE: 50,

  /** Number of members returned per page in member lists */
  MEMBERS_PAGE_SIZE: 25,

  /** Number of classrooms returned per page in teacher filing cabinet */
  CLASSROOMS_PAGE_SIZE: 20,

  // ── Content Redaction ─────────────────────────────────────────────────────

  /**
   * Regex pattern for redacting names server-side for unverified members.
   * Format: "Priya Sharma" → "P*** S."
   * The API applies this — frontend blur is visual only and NOT a security control.
   */
  REDACTION_KEEP_FIRST_CHAR: true,

  /** Placeholder returned for message content when user is unverified */
  REDACTED_CONTENT_PLACEHOLDER: '[Verify to read messages]',

  // ── Audit ─────────────────────────────────────────────────────────────────

  /**
   * Minimum years to retain audit logs.
   * After this, logs may be archived but not deleted.
   * Set based on regulatory requirements in your jurisdiction.
   */
  AUDIT_RETENTION_YEARS: 2,

  /** Minimum years to retain auth logs */
  AUTH_LOG_RETENTION_YEARS: 1,

  // ── Feature Flags ─────────────────────────────────────────────────────────

  /** Enable LinkedIn OAuth verification import */
  FEATURE_LINKEDIN_VERIFY: true,

  /** Enable SMS OTP as MFA fallback (requires Twilio config) */
  FEATURE_SMS_MFA: true,

  /** Enable premium features and payments */
  FEATURE_PREMIUM: true,

  /** Enable "Where Are They Now" feature */
  FEATURE_WHERE_ARE_THEY_NOW: true,

  /** Enable memory capsule anniversary feature */
  FEATURE_MEMORY_CAPSULE: false, // P2 — not yet implemented

  /** Enable teacher cross-classroom student search */
  FEATURE_TEACHER_SEARCH: true,

} as const;

export type AppConfig = typeof appConfig;
