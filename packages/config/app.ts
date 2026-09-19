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
   * Upper bound on a single batch code's max_redemptions. SPEC.md §11.5
   * says this "cannot exceed class size," but the classrooms table has no
   * fixed-capacity field to check against — member_count is a live count
   * of people who've already joined, not a target size for NEW batch-code
   * redemptions. This is a configurable administrative ceiling standing in
   * for that missing field.
   */
  MAX_BATCH_CODE_REDEMPTIONS: 200,

  /**
   * How many times to retry generateInstitutionCode() on a collision
   * before giving up. Collision odds with a 6-char code from a 33-symbol
   * alphabet are astronomically small (33^6 ≈ 1.29 billion combinations) —
   * this bound exists to satisfy "must check for uniqueness" defensively,
   * not because collisions are expected in practice.
   */
  CODE_UNIQUENESS_MAX_RETRIES: 5,

  /**
   * Number of student vouches needed for a teacher to become verified.
   * Must come from students in that specific classroom.
   */
  TEACHER_STUDENT_VOUCHES_REQUIRED: 5,

  /** Digit length of the institutional-email OTP code (Method 1) */
  EMAIL_OTP_LENGTH: 6,

  /** How long an institutional-email OTP stays valid before expiring */
  EMAIL_OTP_EXPIRY_MINUTES: 15,

  /**
   * Max incorrect attempts against a single OTP before it is invalidated
   * (brute-force protection). Exceeding this consumes the OTP even if the
   * correct code is entered afterwards — the caller must request a new one.
   */
  EMAIL_OTP_MAX_ATTEMPTS: 3,

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

  /**
   * Refresh token / session expiry in days (SPEC.md §4.3 — "JWT tokens with
   * 7-day expiry"). The access token itself is much shorter-lived — see
   * JWT_ACCESS_EXPIRY_MINUTES — the refresh token is what actually lasts 7 days.
   */
  JWT_EXPIRY_DAYS: 7,

  /**
   * Access token lifetime in minutes. Kept short on purpose — it's the
   * credential sent on every request, so a leak is only dangerous for a
   * few minutes. Clients use POST /auth/refresh to get a new one.
   */
  JWT_ACCESS_EXPIRY_MINUTES: 15,

  /**
   * How long a pending MFA token stays valid. Issued after a password/Google
   * login succeeds (or a signup completes) but before the MFA code is
   * entered — it can only be used against /auth/mfa/* endpoints, never
   * against a protected resource.
   */
  MFA_PENDING_TOKEN_EXPIRY_MINUTES: 10,

  /** How long a forgot-password reset link stays valid before expiring */
  PASSWORD_RESET_TOKEN_EXPIRY_MINUTES: 60,

  /** How long an MFA (lost-authenticator) recovery link stays valid before expiring */
  MFA_RECOVERY_TOKEN_EXPIRY_MINUTES: 60,

  /** Digit length of SMS OTP codes sent for MFA fallback */
  SMS_OTP_LENGTH: 6,

  /** How long an SMS OTP code stays valid before expiring */
  SMS_OTP_EXPIRY_MINUTES: 5,

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

  // ── Classroom ─────────────────────────────────────────────────────────────

  /**
   * How many years back from the current year a classroom still counts as
   * "active" in the teacher filing cabinet view (SPEC.md §12.1) — e.g. 1
   * means batch years [currentYear - 1, currentYear] bubble to the top,
   * everything older collapses into "alumni".
   */
  CLASSROOM_ACTIVE_YEAR_WINDOW: 1,

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

  // ── Admin portal ─────────────────────────────────────────────────────────

  /**
   * How long a signed Supabase Storage URL for a verification document
   * stays valid (SPEC.md §18.3 — "Signed URLs generated on-demand for
   * admin review only (1hr expiry)").
   */
  DOCUMENT_SIGNED_URL_EXPIRY_SECONDS: 3600,

} as const;

export type AppConfig = typeof appConfig;
