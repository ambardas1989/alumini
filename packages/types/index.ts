/**
 * Shared TypeScript types and enums.
 * Used by backend (NestJS), web (Next.js), and mobile (Expo).
 * Import from '@alumini/types' in any app.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum PersonaType {
  ALUMNI   = 'alumni',
  TEACHER  = 'teacher',
  SCHOOL_ADMIN = 'school_admin',
}

export enum PersonaStatus {
  ACTIVE            = 'active',
  PENDING_APPROVAL  = 'pending_approval',
  SUSPENDED         = 'suspended',
}

export enum InstitutionType {
  SCHOOL     = 'school',
  COLLEGE    = 'college',
  UNIVERSITY = 'university',
}

export enum MemberRole {
  STUDENT = 'student',
  TEACHER = 'teacher',
  ADMIN   = 'admin',
}

export enum VerificationStatus {
  PENDING  = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

export enum VerificationMethod {
  EMAIL         = 'email',
  PEER_VOUCH    = 'peer_vouch',
  DOCUMENT      = 'document',
  LINKEDIN      = 'linkedin',
  PERSONAL_CODE = 'personal_code',
  BATCH_CODE    = 'batch_code',
}

export enum ChannelType {
  CLASSROOM    = 'classroom',
  STAFF_ROOM   = 'staff_room',
  STUDENT_ALLEY = 'student_alley',
}

export enum MessageType {
  TEXT        = 'text',
  EVENT_CARD  = 'event_card',
  SYSTEM      = 'system',
  ATTACHMENT  = 'attachment',
}

export enum RsvpStatus {
  GOING     = 'going',
  NOT_GOING = 'not_going',
  MAYBE     = 'maybe',
}

export enum CodeType {
  PERSONAL = 'personal',
  BATCH    = 'batch',
}

export enum MfaMethod {
  TOTP = 'totp',
  SMS  = 'sms',
}

export enum AuditEventType {
  // Auth
  AUTH_LOGIN_SUCCESS      = 'auth.login.success',
  AUTH_LOGIN_FAILURE      = 'auth.login.failure',
  AUTH_MFA_SETUP          = 'auth.mfa.setup',
  AUTH_MFA_SUCCESS        = 'auth.mfa.success',
  AUTH_MFA_FAILURE        = 'auth.mfa.failure',
  AUTH_MFA_CHALLENGE      = 'auth.mfa.challenge',
  AUTH_PASSWORD_CHANGED   = 'auth.password.changed',
  AUTH_SESSION_INVALIDATED= 'auth.session.invalidated',
  AUTH_LOGOUT             = 'auth.logout',
  AUTH_TOKEN_REFRESHED    = 'auth.token.refreshed',

  // Persona
  PERSONA_SWITCHED        = 'persona.switched',
  PERSONA_ADDED           = 'persona.added',
  PERSONA_REMOVED         = 'persona.removed',

  // Verification
  VERIFICATION_SUBMITTED  = 'verification.submitted',
  VERIFICATION_APPROVED   = 'verification.approved',
  VERIFICATION_REJECTED   = 'verification.rejected',
  VERIFICATION_EXPIRED    = 'verification.expired',

  // Classroom
  CLASSROOM_CREATED       = 'classroom.created',
  CLASSROOM_JOINED        = 'classroom.joined',
  CLASSROOM_LEFT          = 'classroom.left',

  // Institution
  INSTITUTION_CLAIMED     = 'institution.claimed',
  INSTITUTION_CLAIM_APPROVED = 'institution.claim.approved',
  INSTITUTION_CLAIM_REJECTED = 'institution.claim.rejected',
  INSTITUTION_ADMIN_INVITED  = 'institution.admin.invited',
  INSTITUTION_ADMIN_ACCEPTED = 'institution.admin.accepted',
  INSTITUTION_ADMIN_REMOVED  = 'institution.admin.removed',
  INSTITUTION_ADMIN_TRANSFERRED = 'institution.admin.transferred',

  // Codes
  CODE_GENERATED          = 'code.generated',
  CODE_REDEEMED           = 'code.redeemed',
  CODE_EXPIRED            = 'code.expired',

  // Admin actions
  ADMIN_VERIFICATION_APPROVED = 'admin.verification.approved',
  ADMIN_VERIFICATION_REJECTED = 'admin.verification.rejected',
  ADMIN_BULK_IMPORT           = 'admin.bulk_import',

  // Messages
  MESSAGE_DELETED         = 'message.deleted',

  // Events
  EVENT_CREATED           = 'event.created',
  EVENT_DELETED           = 'event.deleted',
}

// ── Core Entity Types ─────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  phone?: string;
  mfaEnabled: boolean;
  mfaMethod?: MfaMethod;
  activePersona: PersonaType;
  linkedinUrl?: string;
  linkedinVerified: boolean;
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
