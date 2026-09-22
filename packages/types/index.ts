/**
 * Shared TypeScript types and enums.
 * Used by backend (NestJS), web (Next.js), and mobile (Expo).
 * Import from '@alumini/types' in any app.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────
//
// Plain `as const` objects, not `enum` — Render runs on Node.js versions
// whose native TypeScript support (type-stripping, no real compile step)
// rejects `enum`/`const enum` outright ("TypeScript enum is not supported
// in strip-only mode"). This pattern is a drop-in replacement for every
// existing call site: `export const X = {...} as const` gives the same
// `X.MEMBER` value access a real enum gave, and the paired
// `export type X = (typeof X)[keyof typeof X]` gives the same union-type
// behavior (`role: X`, function params typed `X`, etc.) — TypeScript
// merges a const and a type of the same name into one importable name,
// exactly like `enum X` did. No call site elsewhere in this codebase
// needed to change for this.
//
// One thing this pattern does NOT replicate: referencing a single enum
// MEMBER as its own type (`type T = SomeEnum.MEMBER`, for narrowing to one
// specific member rather than the whole union) doesn't work the same way
// for a const object. Nothing in this codebase does that — confirmed by
// grep across apps/backend/src before this conversion — but flagging it
// here in case future code reaches for it.

export const PersonaType = {
  ALUMNI: 'alumni',
  TEACHER: 'teacher',
  SCHOOL_ADMIN: 'school_admin',
} as const;
export type PersonaType = (typeof PersonaType)[keyof typeof PersonaType];

export const PersonaStatus = {
  ACTIVE: 'active',
  PENDING_APPROVAL: 'pending_approval',
  SUSPENDED: 'suspended',
} as const;
export type PersonaStatus = (typeof PersonaStatus)[keyof typeof PersonaStatus];

export const InstitutionType = {
  SCHOOL: 'school',
  COLLEGE: 'college',
  UNIVERSITY: 'university',
} as const;
export type InstitutionType = (typeof InstitutionType)[keyof typeof InstitutionType];

export const MemberRole = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  ADMIN: 'admin',
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const VerificationStatus = {
  PENDING: 'pending',
  PENDING_AUTO: 'pending_auto',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const VerificationMethod = {
  EMAIL: 'email',
  PEER_VOUCH: 'peer_vouch',
  DOCUMENT: 'document',
  LINKEDIN: 'linkedin',
  PERSONAL_CODE: 'personal_code',
  BATCH_CODE: 'batch_code',
} as const;
export type VerificationMethod = (typeof VerificationMethod)[keyof typeof VerificationMethod];

export const ChannelType = {
  CLASSROOM: 'classroom',
  STAFF_ROOM: 'staff_room',
  STUDENT_ALLEY: 'student_alley',
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const MessageType = {
  TEXT: 'text',
  EVENT_CARD: 'event_card',
  SYSTEM: 'system',
  ATTACHMENT: 'attachment',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const RsvpStatus = {
  GOING: 'going',
  NOT_GOING: 'not_going',
  MAYBE: 'maybe',
} as const;
export type RsvpStatus = (typeof RsvpStatus)[keyof typeof RsvpStatus];

export const CodeType = {
  PERSONAL: 'personal',
  BATCH: 'batch',
} as const;
export type CodeType = (typeof CodeType)[keyof typeof CodeType];

export const MfaMethod = {
  TOTP: 'totp',
  SMS: 'sms',
} as const;
export type MfaMethod = (typeof MfaMethod)[keyof typeof MfaMethod];

export const AuditEventType = {
  // Auth
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILURE: 'auth.login.failure',
  AUTH_MFA_SETUP: 'auth.mfa.setup',
  AUTH_MFA_SUCCESS: 'auth.mfa.success',
  AUTH_MFA_FAILURE: 'auth.mfa.failure',
  AUTH_MFA_CHALLENGE: 'auth.mfa.challenge',
  AUTH_MFA_RESET: 'auth.mfa.reset',
  AUTH_MFA_RECOVERY_REQUESTED: 'auth.mfa.recovery_requested',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
  AUTH_PASSWORD_CHANGED: 'auth.password.changed',
  AUTH_SESSION_INVALIDATED: 'auth.session.invalidated',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_TOKEN_REFRESHED: 'auth.token.refreshed',

  // Persona
  PERSONA_SWITCHED: 'persona.switched',
  PERSONA_ADDED: 'persona.added',
  PERSONA_REMOVED: 'persona.removed',

  // Verification
  VERIFICATION_SUBMITTED: 'verification.submitted',
  VERIFICATION_APPROVED: 'verification.approved',
  VERIFICATION_REJECTED: 'verification.rejected',
  VERIFICATION_EXPIRED: 'verification.expired',

  // Classroom
  CLASSROOM_CREATED: 'classroom.created',
  CLASSROOM_JOINED: 'classroom.joined',
  CLASSROOM_LEFT: 'classroom.left',
  CLASSROOM_SETTINGS_UPDATED: 'classroom.settings.updated',
  CLASSROOM_ADMIN_PROMOTED: 'classroom.admin.promoted',
  CLASSROOM_ADMIN_DEMOTED: 'classroom.admin.demoted',

  // Institution
  INSTITUTION_CLAIMED: 'institution.claimed',
  INSTITUTION_CLAIM_APPROVED: 'institution.claim.approved',
  INSTITUTION_CLAIM_REJECTED: 'institution.claim.rejected',
  INSTITUTION_REQUEST_SUBMITTED: 'institution.request.submitted',
  INSTITUTION_REQUEST_APPROVED: 'institution.request.approved',
  INSTITUTION_REQUEST_REJECTED: 'institution.request.rejected',
  INSTITUTION_ADMIN_INVITED: 'institution.admin.invited',
  INSTITUTION_ADMIN_ACCEPTED: 'institution.admin.accepted',
  INSTITUTION_ADMIN_REMOVED: 'institution.admin.removed',
  INSTITUTION_ADMIN_TRANSFERRED: 'institution.admin.transferred',

  // Codes
  CODE_GENERATED: 'code.generated',
  CODE_REDEEMED: 'code.redeemed',
  CODE_EXPIRED: 'code.expired',

  // Admin actions
  ADMIN_VERIFICATION_APPROVED: 'admin.verification.approved',
  ADMIN_VERIFICATION_REJECTED: 'admin.verification.rejected',
  ADMIN_VERIFICATION_DOCUMENT_ACCESSED: 'admin.verification.document_accessed',
  ADMIN_BULK_IMPORT: 'admin.bulk_import',

  // Messages
  MESSAGE_DELETED: 'message.deleted',

  // Events
  EVENT_CREATED: 'event.created',
  EVENT_DELETED: 'event.deleted',
} as const;
export type AuditEventType = (typeof AuditEventType)[keyof typeof AuditEventType];

export const ErrorCode = {
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_NOT_FOUND: 'AUTH_ACCOUNT_NOT_FOUND',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  AUTH_MFA_INVALID_CODE: 'AUTH_MFA_INVALID_CODE',
  AUTH_MFA_EXPIRED: 'AUTH_MFA_EXPIRED',
  AUTH_MFA_MAX_ATTEMPTS: 'AUTH_MFA_MAX_ATTEMPTS',
  AUTH_ACCOUNT_SUSPENDED: 'AUTH_ACCOUNT_SUSPENDED',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  VERIFICATION_OTP_INVALID: 'VERIFICATION_OTP_INVALID',
  VERIFICATION_OTP_EXPIRED: 'VERIFICATION_OTP_EXPIRED',
  VERIFICATION_OTP_MAX_ATTEMPTS: 'VERIFICATION_OTP_MAX_ATTEMPTS',
  VERIFICATION_CODE_INVALID: 'VERIFICATION_CODE_INVALID',
  VERIFICATION_CODE_EXPIRED: 'VERIFICATION_CODE_EXPIRED',
  VERIFICATION_CODE_REDEEMED: 'VERIFICATION_CODE_REDEEMED',
  CLASSROOM_DUPLICATE: 'CLASSROOM_DUPLICATE',
  INSTITUTION_REQUEST_DUPLICATE: 'INSTITUTION_REQUEST_DUPLICATE',
  CLASSROOM_NOT_MEMBER: 'CLASSROOM_NOT_MEMBER',
  CHANNEL_ACCESS_DENIED: 'CHANNEL_ACCESS_DENIED',
  MESSAGES_LOAD_FAILED: 'MESSAGES_LOAD_FAILED',
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Core Entity Types ─────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  phone?: string;
  mfaEnabled: boolean;
  mfaMethod?: MfaMethod;
  isPlatformAdmin: boolean;
  activePersona: PersonaType;
  linkedinUrl?: string;
  linkedinVerified: boolean;
  /** TASKS_05 TASK 06 — the "connect LinkedIn" OAuth feature (profile enrichment). Distinct from linkedinUrl/linkedinVerified above, which belong to the classroom-verification LinkedIn method. */
  linkedinConnected?: boolean;
  linkedinName?: string;
  linkedinAvatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Persona {
  id: string;
  userId: string;
  type: PersonaType;
  institutionId?: string;
  status: PersonaStatus;
  isPrimaryAdmin: boolean;
  createdAt: string;
}

export interface Institution {
  id: string;
  name: string;
  slug: string;
  type: InstitutionType;
  cityCode?: string;
  countryCode: string;
  emailDomain?: string;
  isPartner: boolean;
  isClaimed: boolean;
  claimedBy?: string;
  claimedAt?: string;
  createdAt: string;
  /** Public Storage URL — see supabase/migrations/016_institution_logos.sql */
  logoUrl?: string;
}

export interface Classroom {
  id: string;
  globalId: string;
  institutionId: string;
  name: string;
  batchYear: number;
  grade?: string;
  section?: string;
  program?: string;
  hasStaffRoom: boolean;
  hasStudentAlley: boolean;
  requireVerification: boolean;
  createdBy: string;
  memberCount: number;
  createdAt: string;
  /** Public Storage URL — see supabase/migrations/016_institution_logos.sql */
  coverUrl?: string;
}

export interface Membership {
  id: string;
  userId: string;
  classroomId: string;
  role: MemberRole;
  verificationStatus: VerificationStatus;
  verificationMethod?: VerificationMethod;
  verifiedAt?: string;
  verifiedBy?: string;
  joinedAt: string;
}

export interface Message {
  id: string;
  classroomId: string;
  channel: ChannelType;
  senderId: string;
  content: string;
  messageType: MessageType;
  metadata?: Record<string, unknown>;
  isDeleted: boolean;
  deletedBy?: string;
  deletedAt?: string;
  createdAt: string;
  // Populated by API join:
  sender?: Pick<Profile, 'id' | 'fullName' | 'avatarUrl'>;
}

/** Message shape returned for unverified users — content is redacted */
export interface RedactedMessage extends Omit<Message, 'content' | 'sender'> {
  content: string; // Will be the REDACTED_CONTENT_PLACEHOLDER
  sender?: {
    id: string;
    fullName: string; // Will be "P*** S." format
    avatarUrl?: string; // Will be null
  };
  isRedacted: true;
}

export interface Event {
  id: string;
  classroomId: string;
  createdBy: string;
  title: string;
  eventDate: string;
  location?: string;
  description?: string;
  isOnline: boolean;
  rsvpCounts?: { going: number; notGoing: number; maybe: number };
  userRsvp?: RsvpStatus;
  createdAt: string;
}

export interface InstitutionCode {
  id: string;
  institutionId: string;
  classroomId: string;
  code: string;
  type: CodeType;
  boundName?: string;
  boundEmail?: string;
  maxRedemptions?: number;
  redemptionCount: number;
  isRedeemed: boolean;
  redeemedBy?: string;
  redeemedAt?: string;
  expiresAt: string;
  generatedBy: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  eventType: AuditEventType;
  actorId?: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  persona?: PersonaType;
  createdAt: string;
}

// ── API Response Types ────────────────────────────────────────────────────────

export interface ApiResponse<T = void> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ── Classroom Global ID ────────────────────────────────────────────────────────

export interface ClassroomIdParams {
  countryCode: string;
  cityCode?: string;        // Required for schools
  institutionSlug: string;
  grade?: string;           // Required for schools (e.g. '9', '10', '12')
  section?: string;         // Optional (e.g. 'A', 'B')
  program?: string;         // Required for colleges (e.g. 'MBA', 'BTECH')
  batchYear: number;
}
