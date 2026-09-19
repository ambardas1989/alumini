/**
 * Typed HTTP client for the backend API (apps/backend, deployed as
 * NEXT_PUBLIC_API_URL). One function per endpoint — pages/components never
 * call fetch() directly, they import from here.
 *
 * A few endpoints' function signatures were adjusted from a literal
 * "one function per bullet point" reading when the real backend route
 * needs more than that bullet implied (e.g. a required path param or
 * request-body field with no sensible default). Each of those is flagged
 * with a comment at its call site.
 */

import type {
  Profile,
  Persona,
  Institution,
  Classroom,
  Membership,
  Message,
  RedactedMessage,
  InstitutionCode,
  Event as ClassroomEvent,
  PersonaType,
  MfaMethod,
  ChannelType,
  RsvpStatus,
} from '@alumini/types';
import { getToken, clearSession, type User } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Every failure this client can produce, wrapped in one typed shape —
 * callers never see a raw fetch/DOMException. `errorCode` is a
 * packages/types ErrorCode value when the backend provided one (see
 * AllExceptionsFilter), null for network/timeout failures or responses
 * with no structured code. `payload` is the full decoded JSON body — most
 * callers only need `errorCode`/`message`, but a few error responses carry
 * extra fields beyond those (e.g. classroom creation's 409 conflict body
 * includes existingClassroomId/globalId/memberCount — see
 * ClassroomService.createClassroom() on the backend).
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string | null,
    message: string,
    public payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Core request plumbing ───────────────────────────────────────────────────

type QueryValue = string | number | boolean | undefined;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /**
   * Overrides the Authorization header. Needed for the brief pre-session
   * window between login()/signup() and a completed MFA challenge, where
   * the caller only holds a short-lived mfaPendingToken (see
   * lib/mfaSession.ts) — not a real session token from lib/auth.ts's
   * getToken(), which is what every other call implicitly uses below.
   */
  token?: string;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function extractMessage(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
  }
  return 'Something went wrong. Please try again.';
}

function extractErrorCode(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const code = (payload as { error: unknown }).error;
    if (typeof code === 'string') return code;
  }
  return null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = options.token ?? getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, null, 'Request timed out. Try again.');
    }
    throw new ApiError(0, null, 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    clearSession();
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login?message=session_expired';
    }
    throw new ApiError(401, 'AUTH_SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, extractErrorCode(payload), extractMessage(payload), payload);
  }

  return payload as T;
}

// ── AUTH ─────────────────────────────────────────────────────────────────

export interface MfaRequiredResponse {
  mfaRequired: true;
  mfaPendingToken: string;
  mfaMethod: MfaMethod | null;
}

export interface SetupMfaResponse {
  qrCodeUrl: string;
  secret: string;
}

/** Matches POST /auth/mfa/verify and /auth/mfa/challenge's response — apps/backend LoginResponseDto. */
export interface LoginResponse {
  accessToken: string;
  expiresAt: string;
  user: User;
}

export function signup(fullName: string, email: string, password: string): Promise<MfaRequiredResponse> {
  return request('/auth/signup', { method: 'POST', body: { fullName, email, password } });
}

export function login(email: string, password: string): Promise<MfaRequiredResponse> {
  return request('/auth/login', { method: 'POST', body: { email, password } });
}

/**
 * GET /auth/google is a browser-redirect flow (passport → Google's consent
 * screen), not a JSON endpoint — there's nothing to fetch(). This just
 * builds the URL for the caller to navigate to
 * (`window.location.href = googleAuth()`).
 */
export function googleAuth(): string {
  return `${API_BASE_URL}/auth/google`;
}

/**
 * Starts TOTP enrolment (the default/only method this covers — see GET
 * /auth/mfa/setup). Takes the mfaPendingToken explicitly (see
 * lib/mfaSession.ts) — at this point in the flow there is no real session
 * for the default Authorization header (lib/auth.ts's getToken()) to send.
 */
export function setupMfa(token: string): Promise<SetupMfaResponse> {
  return request<{ method: string; qrCodeDataUrl: string; secret: string }>('/auth/mfa/setup', {
    token,
  }).then((raw) => ({ qrCodeUrl: raw.qrCodeDataUrl, secret: raw.secret }));
}

/** Confirms MFA enrolment — always TOTP here, matching setupMfa(). Same mfaPendingToken reasoning as setupMfa(). */
export function verifyMfa(token: string, code: string): Promise<LoginResponse> {
  return request('/auth/mfa/verify', { method: 'POST', body: { method: 'totp', code }, token });
}

/**
 * Completes a pending login with the account's enrolled method. Also used,
 * elsewhere in the app, for the sensitive-action MFA re-challenge on an
 * already-logged-in user — that call site passes lib/auth.ts's getToken()
 * explicitly rather than relying on the default, since by then it's a real
 * access token, not an mfaPendingToken.
 */
export function challengeMfa(token: string, code: string): Promise<LoginResponse> {
  return request('/auth/mfa/challenge', { method: 'POST', body: { code }, token });
}

/**
 * NOTE: POST /auth/refresh requires a refresh token in its body
 * (RefreshTokenDto), but this app's session model is access-token-only
 * (see lib/auth.ts) — /auth/mfa/verify never hands one out. This call will
 * 400 until a login path that stores a refresh token exists; callers
 * (AuthProvider's auto-refresh) already treat any failure here as
 * "session over, log in again," which is the safe fallback.
 */
export function refreshToken(): Promise<{ accessToken: string; expiresAt: string }> {
  return request<{ accessToken: string; expiresIn: number }>('/auth/refresh', {
    method: 'POST',
    body: {},
  }).then((raw) => ({
    accessToken: raw.accessToken,
    expiresAt: new Date(Date.now() + raw.expiresIn * 1000).toISOString(),
  }));
}

export function logout(): Promise<void> {
  return request('/auth/logout', { method: 'POST', body: {} });
}

// ── IDENTITY ─────────────────────────────────────────────────────────────

export function getProfile(): Promise<Profile> {
  return request('/identity/profile');
}

export function updateProfile(
  data: Partial<Pick<Profile, 'fullName' | 'avatarUrl' | 'phone' | 'linkedinUrl'>>,
): Promise<Profile> {
  return request('/identity/profile', { method: 'PATCH', body: data });
}

export function getPersonas(): Promise<Persona[]> {
  return request('/identity/personas');
}

export function addPersona(type: PersonaType, institutionId?: string): Promise<Persona> {
  return request('/identity/personas', { method: 'POST', body: { type, institutionId } });
}

/**
 * Backend switches by persona TYPE, not id (profiles.active_persona is a
 * bare type string — see identity.service.ts) — named accordingly rather
 * than "personaId".
 */
export function switchPersona(type: PersonaType): Promise<{ activePersona: PersonaType }> {
  return request('/identity/personas/switch', { method: 'POST', body: { type } });
}

// ── INSTITUTION ──────────────────────────────────────────────────────────

export function searchInstitutions(q: string, countryCode?: string): Promise<Institution[]> {
  return request('/institution/search', { query: { q, countryCode } });
}

/** justification is optional on the backend (ClaimInstitutionDto) — not part of the task's literal signature, added as an optional extra. */
export function claimInstitution(institutionId: string, justification?: string): Promise<unknown> {
  return request(`/institution/${institutionId}/claim`, { method: 'POST', body: { justification } });
}

export interface InstitutionAdminEntry {
  userId?: string;
  email: string;
  status: 'active' | 'pending_approval' | 'invited';
  isPrimaryAdmin: boolean;
  invitedAt?: string;
}

export function getAdmins(institutionId: string): Promise<InstitutionAdminEntry[]> {
  return request(`/institution/${institutionId}/admins`);
}

export function inviteAdmin(institutionId: string, email: string): Promise<void> {
  return request(`/institution/${institutionId}/admins/invite`, { method: 'POST', body: { email } });
}

/** RemoveAdminDto requires a `reason` (audit trail) — added as a required 3rd param, the endpoint 400s without it. */
export function removeAdmin(institutionId: string, userId: string, reason: string): Promise<void> {
  return request(`/institution/${institutionId}/admins/${userId}`, { method: 'DELETE', body: { reason } });
}

// ── CLASSROOM ────────────────────────────────────────────────────────────

export function getMyClassrooms(): Promise<
  Array<{ institution: Institution; classes: Array<Classroom & { userRole: string; verificationStatus: string; isActive: boolean }> }>
> {
  return request('/classroom/my');
}

export function getClassroom(globalId: string): Promise<Classroom & { institution: Institution }> {
  return request(`/classroom/${globalId}`);
}

export interface CreateClassroomData {
  institutionId: string;
  name: string;
  batchYear: number;
  grade?: string;
  section?: string;
  program?: string;
  hasStaffRoom?: boolean;
  hasStudentAlley?: boolean;
  requireVerification?: boolean;
}

/**
 * Shape of the 409 response body when the classroom already exists — see
 * ClassroomService.createClassroom()'s ConflictException on the backend.
 * Read this off `ApiError.payload` (cast, since `payload` is `unknown`)
 * when `createClassroom()` throws with `statusCode === 409`.
 */
export interface ClassroomConflictPayload {
  message: string;
  error: string;
  existingClassroomId: string;
  globalId: string;
  memberCount: number;
  action: 'JOIN_INSTEAD';
}

export function createClassroom(data: CreateClassroomData): Promise<Classroom> {
  return request('/classroom', { method: 'POST', body: data });
}

export function joinClassroom(classroomId: string): Promise<Membership> {
  return request(`/classroom/${classroomId}/join`, { method: 'POST', body: {} });
}

export function leaveClassroom(classroomId: string): Promise<void> {
  return request(`/classroom/${classroomId}/leave`, { method: 'DELETE' });
}

export interface ClassroomMember {
  userId: string;
  role: string;
  verificationStatus: string;
  joinedAt: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export function getMembers(classroomId: string, page = 0): Promise<ClassroomMember[]> {
  return request(`/classroom/${classroomId}/members`, { query: { page } });
}

// ── MEMBERSHIP ───────────────────────────────────────────────────────────
//
// Not in Part 1's endpoint list — apps/backend/src/modules/membership has
// its own controller (missed in the original survey) that the verification
// screen needs: it's the only place that exposes the caller's own
// membership *row id*, which GET /verify/status/:membershipId requires and
// nothing else returns.

export interface MembershipDetail {
  id: string;
  classroom_id: string;
  role: string;
  verification_status: string;
  verification_method: string | null;
  verified_at: string | null;
  joined_at: string;
}

export function getMembership(classroomId: string): Promise<MembershipDetail> {
  return request(`/membership/${classroomId}`);
}

// ── CORRIDOR ─────────────────────────────────────────────────────────────

export function getMessages(
  classroomId: string,
  channel: ChannelType,
  page = 0,
): Promise<Array<Message | RedactedMessage>> {
  return request(`/corridor/${classroomId}/${channel}`, { query: { page } });
}

export function sendMessage(classroomId: string, channel: ChannelType, content: string): Promise<Message> {
  return request(`/corridor/${classroomId}/${channel}`, { method: 'POST', body: { content } });
}

/** DELETE /corridor/:classroomId/message/:messageId needs classroomId too — added ahead of messageId. */
export function deleteMessage(classroomId: string, messageId: string): Promise<void> {
  return request(`/corridor/${classroomId}/message/${messageId}`, { method: 'DELETE' });
}

// ── VERIFICATION ─────────────────────────────────────────────────────────

/** Not in Part 1's endpoint list, but the classroom screen's member-list vouch button needs it. */
export function vouch(
  voucheeId: string,
  classroomId: string,
): Promise<{ vouchPoints: number; required: number; isVerified: boolean }> {
  return request('/verify/vouch', { method: 'POST', body: { voucheeId, classroomId } });
}

export function initiateEmailVerification(classroomId: string, email: string): Promise<void> {
  return request('/verify/email', { method: 'POST', body: { classroomId, institutionalEmail: email } });
}

export function confirmEmailOtp(classroomId: string, otp: string): Promise<{ verified: boolean }> {
  return request('/verify/email/confirm', { method: 'POST', body: { classroomId, otp } });
}

export function submitDocument(classroomId: string, storagePath: string): Promise<{ message: string; expiresAt: string }> {
  return request('/verify/document', { method: 'POST', body: { classroomId, storagePath } });
}

export function verifyLinkedIn(classroomId: string): Promise<{ verified: boolean }> {
  return request('/verify/linkedin', { method: 'POST', body: { classroomId } });
}

export function redeemCode(classroomId: string, code: string): Promise<{ verified: boolean }> {
  return request('/verify/code', { method: 'POST', body: { classroomId, code } });
}

export interface VerificationAttempt {
  method: string;
  status: 'pending' | 'approved' | 'rejected';
  vouch_points: number;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export function getVerificationStatus(membershipId: string): Promise<{
  membershipId: string;
  verificationStatus: string;
  verificationMethod: string | null;
  verifiedAt: string | null;
  latestAttempt: VerificationAttempt | null;
}> {
  return request(`/verify/status/${membershipId}`);
}

// ── EVENTS ───────────────────────────────────────────────────────────────

export function getEvents(classroomId: string): Promise<{ upcoming: ClassroomEvent[]; past: ClassroomEvent[] }> {
  return request(`/events/${classroomId}`);
}

export interface CreateEventData {
  title: string;
  eventDate: string;
  location?: string;
  description?: string;
  isOnline?: boolean;
}

export function createEvent(classroomId: string, data: CreateEventData): Promise<ClassroomEvent> {
  return request(`/events/${classroomId}`, { method: 'POST', body: data });
}

export function rsvpEvent(classroomId: string, eventId: string, status: RsvpStatus): Promise<unknown> {
  return request(`/events/${classroomId}/${eventId}/rsvp`, { method: 'POST', body: { status } });
}

export function removeRsvp(classroomId: string, eventId: string): Promise<void> {
  return request(`/events/${classroomId}/${eventId}/rsvp`, { method: 'DELETE' });
}

// ── SEARCH ───────────────────────────────────────────────────────────────

export function searchStudents(q: string, classroomId?: string): Promise<unknown[]> {
  return request('/search/students', { query: { q, classroomId } });
}

// ── PREMIUM ──────────────────────────────────────────────────────────────

export function getPremiumStatus(): Promise<{ isPremium: boolean; expiresAt: string | null }> {
  return request('/premium/status');
}

export function getPremiumFeatures(): Promise<unknown[]> {
  return request('/premium/features');
}

// ── ADMIN ────────────────────────────────────────────────────────────────

export function getOverview(institutionId: string): Promise<unknown> {
  return request(`/admin/${institutionId}/overview`);
}

export function getClassrooms(institutionId: string): Promise<unknown> {
  return request(`/admin/${institutionId}/classrooms`);
}

export function getPendingVerifications(institutionId: string): Promise<unknown[]> {
  return request(`/admin/${institutionId}/verifications/pending`);
}

export function getDocumentUrl(institutionId: string, verificationId: string): Promise<{ url: string }> {
  return request(`/admin/${institutionId}/verifications/${verificationId}/document`);
}

export function approveVerification(institutionId: string, verificationId: string): Promise<void> {
  return request(`/admin/${institutionId}/verifications/${verificationId}/approve`, { method: 'POST', body: {} });
}

export function rejectVerification(institutionId: string, verificationId: string, reason: string): Promise<void> {
  return request(`/admin/${institutionId}/verifications/${verificationId}/reject`, {
    method: 'POST',
    body: { reason },
  });
}

export interface GeneratePersonalCodeData {
  institutionId: string;
  classroomId: string;
  boundName: string;
  boundEmail: string;
}

export function generatePersonalCode(institutionId: string, data: Omit<GeneratePersonalCodeData, 'institutionId'>): Promise<InstitutionCode> {
  return request('/codes/personal', { method: 'POST', body: { institutionId, ...data } });
}

export interface GenerateBatchCodeData {
  classroomId: string;
  maxRedemptions: number;
}

export function generateBatchCode(institutionId: string, data: GenerateBatchCodeData): Promise<InstitutionCode> {
  return request('/codes/batch', { method: 'POST', body: { institutionId, ...data } });
}

export function getAnalytics(institutionId: string): Promise<unknown> {
  return request(`/admin/${institutionId}/analytics`);
}
