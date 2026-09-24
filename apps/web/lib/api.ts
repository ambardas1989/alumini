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
import { getToken, getRefreshToken, setRefreshToken, isLoggingOut, completeSignOut, type User } from './auth';

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
  /** Extra request headers beyond Content-Type/Authorization — e.g. X-MFA-Code for an MfaChallengeGuard-protected route. */
  headers?: Record<string, string>;
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
  // TASKS_07 TASK 10 — sign-out sets this before clearing the session and
  // forcing a full-page redirect (see lib/auth.ts's completeSignOut()).
  // Any call still in flight or newly triggered in that brief window
  // (e.g. a polling interval that hasn't unmounted yet) short-circuits
  // here instead of racing the redirect with a real network request
  // against a token that's about to be gone.
  if (isLoggingOut()) {
    throw new ApiError(0, null, 'Signed out');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers };
  const sessionToken = getToken();
  const token = options.token ?? sessionToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  // Whether this call is riding the real, already-established session —
  // not a pre-auth call with no token at all (login/signup) and not an
  // explicit override (an mfaPendingToken, or a sensitive-action
  // re-challenge reusing the real token for a one-off purpose). Only in
  // that case does a 401 actually mean "the session itself died" — see
  // the 401 branch below.
  const usingRealSession = options.token === undefined && sessionToken !== null;

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
    if (usingRealSession) {
      completeSignOut('session_expired');
      throw new ApiError(401, 'AUTH_SESSION_EXPIRED', 'Your session has expired. Please log in again.');
    }

    // BUG FIX: this used to treat every 401 as "the session expired" and
    // hard-redirect regardless of what the call actually was. Wrong
    // credentials on /auth/login (AuthService.login() throws
    // UnauthorizedException — a 401) and a wrong MFA code on
    // /auth/mfa/verify|challenge (same exception type, via
    // mfaFailureException()) both hit this branch, wiping out whatever
    // was in sessionStorage and bouncing the user back to
    // /auth/login?message=session_expired before the login/MFA page's own
    // catch block ever got a chance to show "incorrect password"/
    // "incorrect code" inline. Falls through to the normal error path
    // below instead, same as any other non-401 failure.
    const payload: unknown = await response.json().catch(() => null);
    throw new ApiError(401, extractErrorCode(payload), extractMessage(payload), payload);
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
  method: MfaMethod;
  /** TOTP only */
  qrCodeUrl?: string;
  secret?: string;
  /** Email/SMS only — masked */
  destination?: string;
  expiresInSeconds?: number;
}

/** Matches POST /auth/mfa/verify and /auth/mfa/challenge's response — apps/backend LoginResponseDto. */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: User;
}

export function signup(fullName: string, email: string, password: string): Promise<MfaRequiredResponse> {
  return request('/auth/signup', { method: 'POST', body: { fullName, email, password } });
}

/**
 * The direct-session shape AuthService.login() returns when MFA isn't
 * required (see TokenPairResponse on the backend) — unreachable today
 * since appConfig.MFA_REQUIRED is hardcoded `true` in
 * packages/config/app.ts, but the backend's return type is a real union
 * (MfaRequiredResponse | TokenPairResponse), so login() is typed to match
 * rather than assuming the MFA branch always wins.
 */
export interface LoginCompleteResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function login(email: string, password: string): Promise<MfaRequiredResponse | LoginCompleteResponse> {
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
 * Starts enrolment in the given method (defaults to email server-side —
 * see MfaSetupQueryDto). Takes the mfaPendingToken explicitly (see
 * lib/mfaSession.ts) — at this point in the flow there is no real session
 * for the default Authorization header (lib/auth.ts's getToken()) to send.
 */
export function setupMfa(token: string, method?: MfaMethod): Promise<SetupMfaResponse> {
  return request<{ method: MfaMethod; qrCodeDataUrl?: string; secret?: string; email?: string; phone?: string; expiresInSeconds?: number }>(
    '/auth/mfa/setup',
    { token, query: method ? { method } : undefined },
  ).then((raw) => ({
    method: raw.method,
    qrCodeUrl: raw.qrCodeDataUrl,
    secret: raw.secret,
    destination: raw.email ?? raw.phone,
    expiresInSeconds: raw.expiresInSeconds,
  }));
}

/** Confirms MFA enrolment for the given method. Same mfaPendingToken reasoning as setupMfa(). */
export function verifyMfa(token: string, method: MfaMethod, code: string): Promise<LoginResponse> {
  return request('/auth/mfa/verify', { method: 'POST', body: { method, code }, token });
}

/** Resends the email OTP during either the setup or the login/challenge flow — same mfaPendingToken. */
export function resendMfaEmail(token: string): Promise<{ message: string }> {
  return request('/auth/mfa/email/resend', { method: 'POST', token });
}

/**
 * Completes a pending login with the account's enrolled method. Also used,
 * elsewhere in the app, for the sensitive-action MFA re-challenge on an
 * already-logged-in user — that call site passes lib/auth.ts's getToken()
 * explicitly rather than relying on the default, since by then it's a real
 * access token, not an mfaPendingToken.
 */
/**
 * @param peek - TASKS_07 TASK 04. Non-consuming check — verifies the code
 *   without marking a single-use email OTP as used, so the SAME code can
 *   be submitted again for the real action afterward. Used by the profile
 *   page's change-password modal: Step 1 needs a real pass/fail check on
 *   the code the user just typed, but the actual password change (Step 2)
 *   re-submits that same code to POST /auth/change-password. Ignored
 *   server-side when completing a login (mfa_login purpose always
 *   consumes) — every other call site omits it and gets the original,
 *   consuming behaviour unchanged.
 */
export function challengeMfa(token: string, code: string, peek?: boolean): Promise<LoginResponse> {
  return request('/auth/mfa/challenge', { method: 'POST', body: { code, peek }, token });
}

/**
 * Always resolves the same way whether or not the email matches an account
 * — the backend never reveals account existence through this response
 * (see AuthService.forgotPassword()'s own comment).
 */
export function forgotPassword(email: string): Promise<{ message: string }> {
  return request('/auth/forgot-password', { method: 'POST', body: { email } });
}

export function resetPassword(token: string, password: string): Promise<{ message: string }> {
  return request('/auth/reset-password', { method: 'POST', body: { token, password } });
}

/**
 * Changes the password for the current session (profile page's "Change
 * password" modal) — distinct from resetPassword()'s unauthenticated,
 * emailed-link flow: this never signs the caller out. The backend
 * verifies mfaCode in the SAME request via MfaChallengeGuard (X-MFA-Code
 * header), not as a separate pre-verify call — same "one combined
 * verify+act request" pattern every other MfaChallengeGuard route
 * already uses. `token: getToken()` is passed explicitly, same reasoning
 * as challengeMfa(): keeps a wrong-code 401 from being treated as "the
 * session itself expired" and hard-redirecting out of the modal.
 */
export function changePassword(mfaCode: string, newPassword: string): Promise<{ message: string }> {
  return request('/auth/change-password', {
    method: 'POST',
    body: { password: newPassword },
    token: getToken() ?? undefined,
    headers: { 'X-MFA-Code': mfaCode },
  });
}

/**
 * Always resolves the same way whether or not the email matches an
 * account — same reasoning as forgotPassword().
 */
export function requestMfaRecovery(email: string): Promise<{ message: string }> {
  return request('/auth/mfa/recovery-request', { method: 'POST', body: { email } });
}

/** Clears MFA on success and returns a fresh mfa_setup pending token — same shape login()/signup() return when MFA is required. */
export function verifyMfaRecovery(token: string): Promise<MfaRequiredResponse> {
  return request('/auth/mfa/recovery-verify', { method: 'POST', body: { token } });
}

/**
 * BUG FIX (TASKS_03 TASK 02): this used to send an empty body — POST
 * /auth/refresh requires a refresh token (RefreshTokenDto), which
 * /auth/mfa/verify and /auth/mfa/challenge never actually returned even
 * though the backend always generated one (see LoginResponseDto's own
 * comment) — so every call here 400'd, always, on every account. Now sends
 * the refresh token lib/auth.ts persists at login, and stores the NEW one
 * the backend rotates in on success (refresh tokens are single-use —
 * AuthService.refreshTokens() issues a fresh pair each time).
 */
export function refreshToken(): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const current = getRefreshToken();
  if (!current) {
    return Promise.reject(new ApiError(401, 'AUTH_SESSION_EXPIRED', 'No refresh token available'));
  }
  return request<{ accessToken: string; refreshToken: string; expiresIn: number }>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: current },
  }).then((raw) => {
    setRefreshToken(raw.refreshToken);
    return {
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken,
      expiresAt: new Date(Date.now() + raw.expiresIn * 1000).toISOString(),
    };
  });
}

export function logout(): Promise<void> {
  return request('/auth/logout', { method: 'POST', body: {} });
}

/** TASKS_06 TASK 08 P2a — revokes every active session for this account, distinct from logout()'s single-session default. */
export function logoutAllDevices(): Promise<{ message: string; count: number }> {
  return request('/auth/logout/all', { method: 'POST' });
}

export interface SessionInfo {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

/** TASKS_06 TASK 08 P2b — every active session for this account, for the profile page's "Active sessions" list. */
export function listSessions(): Promise<SessionInfo[]> {
  return request('/auth/sessions');
}

/** TASKS_06 TASK 08 P2b — revokes one specific session (not necessarily the current one). */
export function revokeSession(sessionId: string): Promise<void> {
  return request(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
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

/**
 * TASKS_07 TASK 11 / TASKS_08 TASK 04 — routes image uploads (avatar,
 * classroom cover, institution logo) through the backend (service-role
 * Supabase client) instead of the frontend uploading straight to Storage
 * with the anon key. That direct path can never actually work for this
 * app: Storage's RLS policies are keyed on auth.uid(), which only resolves
 * for a real Supabase Auth session — this app issues its own NestJS JWTs
 * and never establishes one, so auth.uid() is always NULL for a
 * client-side upload, and Storage rejects it (the "Invalid Compact JWS" /
 * 403 the avatar-upload task was filed against — Storage trying and
 * failing to parse this app's JWT as its own).
 *
 * Deliberately a raw fetch(), not request(): request() always sets
 * Content-Type: application/json and JSON.stringifies the body — a
 * multipart/form-data upload needs the browser to set Content-Type itself
 * (with the multipart boundary), and FormData isn't JSON-serializable.
 */
async function uploadFile<T>(path: string, fieldName: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch {
    throw new ApiError(0, null, 'Could not reach the server. Check your connection.');
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, extractErrorCode(payload), extractMessage(payload), payload);
  }

  return payload as T;
}

export function uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
  return uploadFile('/identity/avatar', 'avatar', file);
}

// ── LinkedIn connect (profile enrichment) — see auth.service.ts's connectLinkedin() doc comment for scope ──

export interface LinkedinConnectData {
  linkedinId: string;
  name: string | null;
  avatarUrl: string | null;
}

export function connectLinkedin(code: string, redirectUri: string): Promise<{ linkedinData: LinkedinConnectData }> {
  return request('/auth/linkedin/connect', { method: 'POST', body: { code, redirectUri } });
}

export function saveLinkedin(data: {
  linkedinId: string;
  confirmName?: boolean;
  name?: string | null;
  confirmAvatar?: boolean;
  avatarUrl?: string | null;
}): Promise<Pick<Profile, 'linkedinConnected' | 'linkedinName' | 'linkedinAvatarUrl'>> {
  return request('/identity/linkedin/save', { method: 'POST', body: data });
}

export function disconnectLinkedinAccount(): Promise<void> {
  return request('/identity/linkedin/disconnect', { method: 'POST' });
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

/**
 * Matches InstitutionService.listAdmins()'s real shape exactly — the
 * earlier flat-array typing here was wrong. Note admin rows carry no
 * email (the backend's own select doesn't fetch profiles.email for
 * them) — only pending invites have one, from institution_admin_invites
 * itself. Screens showing admin rows work around this.
 */
export interface InstitutionAdminRow {
  id: string;
  user_id: string;
  status: 'active' | 'pending_approval';
  is_primary_admin: boolean;
  created_at: string;
  profile: { id: string; full_name: string; avatar_url: string | null } | null;
}

export interface InstitutionAdminInvite {
  id: string;
  email: string;
  invited_by: string;
  expires_at: string;
  created_at: string;
}

export function getAdmins(
  institutionId: string,
): Promise<{ admins: InstitutionAdminRow[]; pendingInvites: InstitutionAdminInvite[] }> {
  return request(`/institution/${institutionId}/admins`);
}

export function inviteAdmin(institutionId: string, email: string): Promise<void> {
  return request(`/institution/${institutionId}/admins/invite`, { method: 'POST', body: { email } });
}

/** RemoveAdminDto requires a `reason` (audit trail) — added as a required 3rd param, the endpoint 400s without it. */
export function removeAdmin(institutionId: string, userId: string, reason: string): Promise<void> {
  return request(`/institution/${institutionId}/admins/${userId}`, { method: 'DELETE', body: { reason } });
}

// ── INSTITUTION REQUESTS ─────────────────────────────────────────────────

export interface RequestInstitutionInput {
  name: string;
  type: 'school' | 'college' | 'university';
  city?: string;
  cityCode?: string;
  countryCode: string;
  websiteUrl?: string;
  emailDomain?: string;
  requesterRelationship: 'alumni' | 'teacher' | 'admin' | 'other';
  notes?: string;
}

export interface InstitutionConflictPayload {
  existingInstitutionId: string;
  existingInstitutionName: string;
  existingInstitutionSlug: string;
  existingInstitutionType: string;
  existingInstitutionCityCode: string | null;
  existingInstitutionCountryCode: string;
}

export function requestInstitution(dto: RequestInstitutionInput): Promise<{ message: string; requestId: string }> {
  return request('/institution/request', { method: 'POST', body: dto });
}

export interface InstitutionRequestRow {
  id: string;
  name: string;
  type: string;
  city: string | null;
  country_code: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  created_at: string;
}

export function getMyInstitutionRequests(): Promise<InstitutionRequestRow[]> {
  return request('/institution/my-requests');
}

export interface AdminInstitutionRequestRow extends InstitutionRequestRow {
  requested_by: string;
  city_code: string | null;
  website_url: string | null;
  email_domain: string | null;
  requester_relationship: string;
  notes: string | null;
  requester: { full_name: string; email: string } | null;
}

export function adminListInstitutionRequests(status = 'pending', page = 0): Promise<AdminInstitutionRequestRow[]> {
  return request('/admin/institution-requests', { query: { status, page: String(page) } });
}

export function adminApproveInstitutionRequest(
  requestId: string,
  slug: string,
  cityCode?: string,
  emailDomain?: string,
): Promise<{ institution: Institution; message: string }> {
  return request(`/admin/institution-requests/${requestId}/approve`, {
    method: 'POST',
    body: { slug, cityCode, emailDomain },
  });
}

export function adminRejectInstitutionRequest(requestId: string, reason: string): Promise<{ message: string }> {
  return request(`/admin/institution-requests/${requestId}/reject`, { method: 'POST', body: { reason } });
}

// ── CLASSROOM ────────────────────────────────────────────────────────────

export function getMyClassrooms(): Promise<
  Array<{ institution: Institution; classes: Array<Classroom & { userRole: string; verificationStatus: string; isActive: boolean; joinedAt: string }> }>
> {
  return request('/classroom/my');
}

export function getClassroom(globalId: string): Promise<Classroom & { institution: Institution }> {
  return request(`/classroom/${globalId}`);
}

/** TASKS_07 TASK 07 — "Find your batch" platform-wide discovery search, excludes classrooms the caller already joined. */
export interface ClassroomSearchResult {
  id: string;
  globalId: string;
  name: string;
  institutionName: string | null;
  batchYear: number;
  memberCount: number;
  verificationRequired: boolean;
}

export function searchClassrooms(q: string, limit = 10): Promise<ClassroomSearchResult[]> {
  return request('/classroom/search', { query: { q, limit } });
}

/** classroomId is the internal id (Classroom.id), not the globalId in the URL — matches the backend's PATCH /classroom/:id (admin settings) route shape. */
export function uploadClassroomCover(classroomId: string, file: File): Promise<{ coverUrl: string }> {
  return uploadFile(`/classroom/${classroomId}/cover`, 'cover', file);
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
  city?: string;
  state?: string;
  countryCode?: string;
  creatorRole?: 'student' | 'teacher';
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
  linkedinConnected: boolean;
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
  /** TASKS_08 TASK 05 — defaults to 'classroom' on the backend when omitted. */
  channel?: 'classroom' | 'staff_room' | 'student_alley';
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

export interface StudentSearchResult {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  classroomId: string;
  classroomName: string | undefined;
  batchYear: number | undefined;
  verificationStatus: string;
  role: string;
}

export function searchStudents(q: string, classroomId?: string): Promise<StudentSearchResult[]> {
  return request('/search/students', { query: { q, classroomId } });
}

export interface StudentProfile {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  sharedClassrooms: Array<{
    classroomId: string;
    classroomName: string | undefined;
    batchYear: number | undefined;
    globalId: string | undefined;
    role: string;
    verificationStatus: string;
    joinedAt: string;
  }>;
}

export function getStudentProfile(userId: string): Promise<StudentProfile> {
  return request(`/search/students/${userId}`);
}

// ── PREMIUM ──────────────────────────────────────────────────────────────

export function getPremiumStatus(): Promise<{ isPremium: boolean; expiresAt: string | null }> {
  return request('/premium/status');
}

export function getPremiumFeatures(): Promise<unknown[]> {
  return request('/premium/features');
}

// ── ADMIN ────────────────────────────────────────────────────────────────

export interface AdminActivityEntry {
  id: string;
  eventType: string;
  actorId: string | null;
  classroomId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminOverview {
  totalClassrooms: number;
  activeClassrooms: number;
  totalMembers: number;
  totalVerifiedMembers: number;
  pendingVerifications: number;
  activeCodes: number;
  totalAdmins: number;
  recentActivity: AdminActivityEntry[];
  logoUrl: string | null;
}

export function getOverview(institutionId: string): Promise<AdminOverview> {
  return request(`/admin/${institutionId}/overview`);
}

export function uploadInstitutionLogo(institutionId: string, file: File): Promise<{ logoUrl: string }> {
  return uploadFile(`/institution/${institutionId}/logo`, 'logo', file);
}

export interface AdminClassroomEntry {
  id: string;
  globalId: string;
  name: string;
  grade: string | null;
  section: string | null;
  program: string | null;
  memberCount: number;
  verifiedCount: number;
  pendingCount: number;
}

export interface AdminClassroomYearGroup {
  year: number;
  classrooms: AdminClassroomEntry[];
  canAddClassroom: boolean;
}

export function getClassrooms(institutionId: string): Promise<AdminClassroomYearGroup[]> {
  return request(`/admin/${institutionId}/classrooms`);
}

export interface PendingDocumentVerification {
  verificationId: string;
  userId: string;
  userDisplayName: string;
  classroomId: string;
  classroomName: string;
  submittedAt: string;
}

export function getPendingVerifications(institutionId: string): Promise<PendingDocumentVerification[]> {
  return request(`/admin/${institutionId}/verifications/pending`);
}

export function getDocumentUrl(
  institutionId: string,
  verificationId: string,
): Promise<{ url: string; expiresInSeconds: number }> {
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
  expiresInDays?: 7 | 30 | 90;
}

export function generateBatchCode(institutionId: string, data: GenerateBatchCodeData): Promise<InstitutionCode> {
  return request('/codes/batch', { method: 'POST', body: { institutionId, ...data } });
}

export interface AdminAnalytics {
  activeAlumniCount: number;
  topClassrooms: Array<{ classroomId: string; name: string; memberCount: number }>;
  verificationMethodBreakdown: Record<string, number>;
  newMembersThisMonth: number;
  memberGrowth: Array<{ month: string; newMembers: number; cumulative: number }>;
}

export function getAnalytics(institutionId: string): Promise<AdminAnalytics> {
  return request(`/admin/${institutionId}/analytics`);
}

// ── CODES (listing + import — generation is above, alongside overview) ───

export interface CodeEntry {
  id: string;
  code: string;
  type: 'personal' | 'batch';
  boundName: string | null;
  boundEmail: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  status: 'active' | 'redeemed' | 'exhausted' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export function listCodes(classroomId: string): Promise<CodeEntry[]> {
  return request(`/codes/${classroomId}`);
}

/**
 * ImportCsvDto takes the CSV as a plain string (dto.csvContent), not a
 * file upload — the client reads the File's text (File.text()) and sends
 * it as ordinary JSON, no multipart/Storage upload involved.
 */
export function importCsv(
  institutionId: string,
  csvContent: string,
): Promise<{ rowCount: number; generatedCount: number; classroomIds: string[] }> {
  return request('/codes/import', { method: 'POST', body: { institutionId, csvContent } });
}

// ── NOTIFICATIONS ────────────────────────────────────────────────────────

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export function getNotifications(limit = 20): Promise<NotificationRow[]> {
  return request('/notifications', { query: { limit: String(limit) } });
}

export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return request('/notifications/unread-count');
}

export function markNotificationsRead(input: { notificationIds?: string[]; all?: boolean }): Promise<void> {
  return request('/notifications/mark-read', { method: 'POST', body: input });
}

// ── DIRECT MESSAGES ──────────────────────────────────────────────────────

export interface DmConversation {
  user: { id: string; fullName: string | null; avatarUrl: string | null };
  lastMessage: { content: string | null; createdAt: string; isOwn: boolean };
  unreadCount: number;
}

export interface DmMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
}

export function getDmConversations(): Promise<DmConversation[]> {
  return request('/dm/conversations');
}

export function getDmMessages(userId: string, page = 0): Promise<DmMessage[]> {
  return request(`/dm/conversations/${userId}`, { query: { page } });
}

export function sendDmMessage(userId: string, content: string): Promise<DmMessage> {
  return request(`/dm/conversations/${userId}`, { method: 'POST', body: { content } });
}

export function markDmRead(userId: string): Promise<void> {
  return request(`/dm/conversations/${userId}/read`, { method: 'POST' });
}
