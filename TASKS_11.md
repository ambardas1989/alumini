# AlumTribe — Task Batch 11
# Institution Admin Dashboard (MVP)

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_11.md along with the code changes
- If a task fails, change [PENDING] to [FAILED: reason] and STOP
- Do not move to the next task until the current one fully passes
- Run `npm run test` after every task — all tests must pass
- Run `next build` after any frontend task before committing
- All commits go to main

If resuming after interruption:
- Read this file first
- Find the first task still [PENDING]
- Start from there

---

## CONTEXT

Institution admins are staff members of a school or college
who manage AlumTribe for their entire institution across all
classrooms. This is AlumTribe's Tier 3 subscription product
and the primary B2B revenue source.

Two ways an institution admin is created:
  1. They submit a request form → Ambar approves from
     platform admin panel
  2. Ambar sends them a special invite link directly

Institution admin scope:
  - Can manage ALL classrooms under their institution
  - Can see ALL members across all classrooms
  - Can approve/reject verifications institution-wide
  - Can generate batch invite codes per classroom
  - Cannot access other institutions

Route prefix for all institution admin pages:
  /institution-admin/[institutionId]/...

A user can be institution admin of multiple institutions
(rare but possible — e.g. a chain of schools).

---

## TASK 01 — Institution admin access — request and invite flow [DONE] — ADAPTED per explicit product direction: this codebase already had a fully-built, tested institution-admin system (InstitutionService's personas/school_admin + claim/invite flow, SPEC.md §11) — built a new institution_admins table would have created two parallel sources of truth. Instead extended the existing system: requestAdminAccess() (works even on an already-claimed institution, unlike submitClaim()), approveClaim()/rejectClaim() now platform-admin-gated and exposed via a new InstitutionAdminController, inviteAdmin()/acceptInvite() extended to let a platform admin invite/bootstrap an admin directly. Added personas.requested_role/requested_message (031_institution_admin_requests.sql) for the review-queue UI. Frontend: /institution-admin/request, /institution-admin/accept-invite, and a new "Admin Access" tab on the existing /admin platform-admin dashboard.

Two entry points for becoming an institution admin.
Both result in is_institution_admin = true on the
institution_admins table (create if not exists).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create supabase/migrations/030_institution_admins.sql:

  CREATE TABLE IF NOT EXISTS public.institution_admins (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    institution_id uuid REFERENCES public.institutions(id)
      ON DELETE CASCADE,
    status text CHECK (status IN (
      'pending', 'approved', 'rejected', 'invited'
    )) DEFAULT 'pending',
    invited_by uuid REFERENCES public.profiles(id),
    invite_token text UNIQUE,
    invite_expires_at timestamptz,
    requested_at timestamptz DEFAULT now(),
    approved_at timestamptz,
    approved_by uuid REFERENCES public.profiles(id),
    notes text,
    UNIQUE(user_id, institution_id)
  );

  ALTER TABLE public.institution_admins ENABLE ROW LEVEL SECURITY;

  -- Platform admins can read and update all
  CREATE POLICY "institution_admins_platform"
  ON public.institution_admins FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND is_platform_admin = true
    )
  );

  -- Users can read their own records
  CREATE POLICY "institution_admins_own"
  ON public.institution_admins FOR SELECT
  USING (user_id = auth.uid());

Add to fileUpdates.md — apply manually in Supabase SQL Editor.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND — request flow
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/backend/src/modules/institution-admin/
  institution-admin.module.ts
  institution-admin.controller.ts
  institution-admin.service.ts
  dto/request-access.dto.ts
  dto/approve-access.dto.ts

POST /v1/institution-admin/request
Auth: required (any verified user)
Body: { institutionId, fullName, role, message }
  role: their role at the institution
    (principal, vice-principal, admin-staff, teacher)
  message: why they should be admin (optional, 500 chars)
Action:
  Check no existing pending/approved record for this
  user + institution combination.
  Insert into institution_admins with status: 'pending'.
  Notify platform admins via in-app notification:
    type: 'institution_admin_request'
    title: "[Name] requested institution admin access"
    body: "[Institution name] · [role]"
  Return: { message: 'Request submitted. We will review shortly.' }

Log:
  info: '[INST-ADMIN:request] submitted'
  { userId, institutionId }
  error: '[INST-ADMIN:request] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND — invite flow
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

POST /v1/institution-admin/invite (platform admin only)
Auth: required + is_platform_admin = true
Body: { institutionId, email, expiresInDays? (default 7) }
Action:
  Generate a secure random invite_token (32 chars)
  Set invite_expires_at = now + expiresInDays
  Insert into institution_admins with status: 'invited'
    and invite_token
  Send email via Resend to the provided email:
    Subject: "You've been invited to manage [Institution]
      on AlumTribe"
    Body: invitation email with link:
      https://alumtribe.com/institution-admin/accept-invite
        ?token=[invite_token]
  Return: { inviteLink, expiresAt }

POST /v1/institution-admin/accept-invite
Auth: required (must be logged in to accept)
Body: { token }
Action:
  Find institution_admins record by invite_token
  Check status = 'invited' and invite_expires_at > now
  If expired: return 400 'Invite link has expired'
  Update: status = 'approved', approved_at = now,
    invite_token = null, invite_expires_at = null
  Return: { institutionId, institutionName }
  Redirect frontend to /institution-admin/[institutionId]

Log:
  info: '[INST-ADMIN:invite] sent' { institutionId, email }
  info: '[INST-ADMIN:accept] accepted' { userId, institutionId }
  error: '[INST-ADMIN:invite] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND — platform admin approval
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATCH /v1/institution-admin/:id/approve (platform admin only)
Auth: required + is_platform_admin = true
Body: { notes? }
Action:
  Update status = 'approved', approved_at = now,
    approved_by = currentUserId
  Notify the requesting user:
    type: 'institution_admin_approved'
    title: "Institution admin access approved"
    body: "You can now manage [Institution name]"
  Return: updated record

PATCH /v1/institution-admin/:id/reject (platform admin only)
Auth: required + is_platform_admin = true
Body: { notes? }
Action:
  Update status = 'rejected'
  Notify the requesting user:
    type: 'institution_admin_rejected'
    title: "Institution admin request update"
    body: "Your request for [Institution] was not approved"
  Return: updated record

GET /v1/institution-admin/requests (platform admin only)
Auth: required + is_platform_admin = true
Query: status? (filter by pending/approved/rejected/invited)
Returns: paginated list of requests with user and
  institution details

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — request access page
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/request/page.tsx

Simple form:
  Institution search (same autocomplete as classroom creation)
  Role at institution (dropdown):
    Principal / Vice Principal / Admin Staff / Teacher
  Message (optional textarea, 500 chars)
  Submit button: "Request access"

On submit: POST /v1/institution-admin/request
On success: show confirmation card:
  "Request submitted. We'll review and get back to you."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — accept invite page
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/accept-invite/page.tsx

Read token from URL query param.
If user not logged in: redirect to login with returnUrl.
If logged in: show institution name + "Accept invitation" button.
On accept: POST /v1/institution-admin/accept-invite
On success: redirect to /institution-admin/[institutionId]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — platform admin requests list
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/platform-admin/page.tsx or wherever
the platform admin panel exists.

Add a new section "Institution admin requests":
  Tab or section showing pending requests
  Each row: user name + institution + role + message
    + Approve button + Reject button
  Filter tabs: Pending / Approved / Rejected / Invited
  Approved/Rejected rows are read-only with status badge

Run: npm run test and next build
Commit: "feat: institution admin request and invite
flow with platform admin approval"
Push.

---

## TASK 02 — Institution admin — auth guard and layout [DONE] — ADAPTED per explicit product direction: skipped the new /institution-admin/[institutionId]/layout.tsx route tree entirely — /admin already has an equivalent layout (top bar + tab bar, Overview/Verify/Classrooms/Codes/Stats/Admins). Guard requirement ("approved institution admin for this institution OR platform admin") implemented as a private assertX() method per this codebase's house convention (no shared Guard class exists anywhere for role checks) — AdminService.assertSchoolAdmin() now also accepts a platform admin, purely additive. Added an institution search/picker on /admin so a platform admin without their own school_admin persona can view any institution's full tab set.

Create the auth guard and shared layout for all institution
admin pages. Any route under /institution-admin/[institutionId]
must verify the current user is an approved institution admin
for that specific institution.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND — guard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/backend/src/common/guards/
  institution-admin.guard.ts

The guard checks:
  1. User is authenticated (valid JWT)
  2. institutionId param exists in the request
  3. A record exists in institution_admins where:
     user_id = currentUserId
     institution_id = institutionId param
     status = 'approved'
  4. OR user is platform admin (is_platform_admin = true)

Apply this guard to ALL institution admin controller routes.

Log:
  warn: '[INST-ADMIN:guard] access denied'
  { userId, institutionId }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — layout
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  layout.tsx

Layout includes:
  Top bar:
    Institution logo (40px, initials fallback)
    Institution name (bold)
    "Admin portal" label (muted, small)
    User avatar top right with logout option

  Left sidebar (desktop) or bottom nav (mobile):
    Overview (home icon)
    Classrooms
    Members
    Verifications
    Batch codes
    Announcements
    Admins
    Analytics
    Subscription

  Active nav item highlighted.
  Mobile: bottom nav with icons only, labels on active.

  If user is not an approved institution admin for this
  institutionId: show access denied screen with link to
  request access.

Run: npm run test and next build
Commit: "feat: institution admin guard and layout"
Push.

---

## TASK 03 — Institution setup — profile and branding [DONE] — ADAPTED per TASK 02's direction: new Settings tab on /admin (not a separate route). Migration added 032_institution_profile.sql (cover_photo_url/address/website/description/founded_year/board/medium — name/logo_url/type already existed). New GET/PATCH /institution/:id/profile and POST /institution/:id/cover-photo on the existing InstitutionController (same assertActiveAdminOrPlatformAdmin guard as the existing logo upload, factored out for reuse). Logo upload itself already existed on OverviewTab — not duplicated.

Institution admin can view and edit their institution's
profile: name, logo, cover photo, address, website, type.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check institutions table for missing columns.
Add if not present via migration:

  ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS cover_photo_url text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS founded_year integer,
  ADD COLUMN IF NOT EXISTS board text,
  ADD COLUMN IF NOT EXISTS medium text;

Add to fileUpdates.md for manual Supabase application.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/backend/src/modules/institution-admin/
  institution-profile.controller.ts (or add to existing)

GET /v1/institution-admin/:institutionId/profile
Auth: institution admin guard
Returns: full institution record

PATCH /v1/institution-admin/:institutionId/profile
Auth: institution admin guard
Body: { name?, address?, website?, description?,
  foundedYear?, board?, medium? }
Updates institution record.

POST /v1/institution-admin/:institutionId/logo
Auth: institution admin guard
Body: multipart file upload
Action: upload via supabaseAdmin service role to
  institutions-media bucket.
  Update institution logo_url.
  Return: { logoUrl }

POST /v1/institution-admin/:institutionId/cover-photo
Auth: institution admin guard
Body: multipart file upload
Action: same pattern as logo upload.
  Update institution cover_photo_url.
  Return: { coverPhotoUrl }

Log:
  info: '[INST-ADMIN:profile] updated' { institutionId }
  info: '[INST-ADMIN:logo] uploaded' { institutionId }
  error: '[INST-ADMIN:profile] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  settings/page.tsx

Sections:
  Branding:
    Logo upload (circle, 120px, tap to change)
    Cover photo upload (banner, 16:9 ratio)
    Both upload via backend — never direct to Supabase

  Basic info:
    Name (text input)
    Type (school / college / university — read only)
    Founded year (number input)
    Board (CBSE / ICSE / State / IB / Other)
    Medium (English / Hindi / Regional / Other)
    Address (textarea)
    Website (url input)
    Description (textarea, 500 chars)

  Save button at bottom of each section.

Run: npm run test and next build
Commit: "feat: institution admin profile and branding
settings with logo and cover photo upload"
Push.

---

## TASK 04 — Institution admin — subscription management [DONE] — ADAPTED onto a new Subscription tab on /admin (see TASK 02's direction). New institution_subscriptions table (033_institution_subscriptions.sql, lazily created on first PATCH) + GET/PATCH/request-upgrade routes on the existing InstitutionController, reusing assertActiveAdminOrPlatformAdmin/assertPlatformAdmin. No payment processing, same scope limit PremiumService already documents for per-user premium. Platform-admin PATCH route has no frontend UI yet (not asked for in this task's frontend section) — reachable via API only for now.

Institution admin can view their current subscription plan,
upgrade, and manage billing. This is a lightweight
implementation — no payment processing yet, just the UI
and status tracking. Actual payment integration is a
separate task.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create supabase/migrations/033_institution_subscriptions.sql:

  CREATE TABLE IF NOT EXISTS public.institution_subscriptions (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    institution_id uuid REFERENCES public.institutions(id)
      ON DELETE CASCADE UNIQUE,
    plan text CHECK (plan IN ('free', 'tier3'))
      DEFAULT 'free',
    status text CHECK (status IN (
      'active', 'inactive', 'trial', 'cancelled'
    )) DEFAULT 'inactive',
    trial_ends_at timestamptz,
    current_period_start timestamptz,
    current_period_end timestamptz,
    max_classrooms integer DEFAULT 5,
    max_members_per_classroom integer DEFAULT 100,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );

Add to fileUpdates.md.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET /v1/institution-admin/:institutionId/subscription
Auth: institution admin guard
Returns: subscription record or { plan: 'free',
  status: 'inactive' } if none exists

POST /v1/institution-admin/:institutionId/subscription/request-upgrade
Auth: institution admin guard
Body: { plan: 'tier3', message? }
Action:
  Notify platform admins:
    type: 'subscription_upgrade_request'
    title: "[Institution] requested Tier 3 upgrade"
    body: message or "No message provided"
  Return: { message: 'Upgrade request sent. We will
    contact you shortly.' }

PATCH /v1/institution-admin/:institutionId/subscription
  (platform admin only)
Auth: is_platform_admin = true
Body: { plan, status, trialEndsAt?, currentPeriodEnd?,
  maxClassrooms?, maxMembersPerClassroom? }
Updates subscription record.
Notifies institution admin of plan change.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  subscription/page.tsx

Current plan card:
  Plan name (Free / Tier 3)
  Status badge (Active / Trial / Inactive)
  If trial: "Trial ends [date]"
  If active: "Renews [date]"
  Limits: max classrooms, max members per classroom

Tier 3 features list (even on free plan — shows what
  they'd get):
  ✓ Unlimited classrooms
  ✓ Unlimited members
  ✓ Institution-wide announcements
  ✓ Advanced analytics
  ✓ Priority support
  ✓ Verified institution badge

If on free plan:
  "Upgrade to Tier 3" button → sends upgrade request
  After sending: "Request sent. Our team will reach out."

If on Tier 3:
  Contact support link for billing queries
  No self-serve cancellation — must contact support

Run: npm run test and next build
Commit: "feat: institution admin subscription page
with upgrade request flow"
Push.

---

## TASK 05 — Institution admin — admin role management [DONE] — Institution-level admin roster (list/invite/remove) already existed on AdminsTab (now also shows email). Added the missing "classroom admins" half: GET/PATCH /institution/:id/classroom-admins (list role=admin across all of the institution's classrooms; promote/demote), as a self-contained sibling to MembershipService.changeRole() rather than modifying that method's existing single-classroom scope. Demote's "revert to original role" uses the same active-teacher-persona check TASKS_10 TASK 03 established for classroom creation, since verification_method doesn't actually encode a prior role. Promote flow: pick classroom → pick non-admin member from it → confirm (institution-wide member search comes in TASK 09, not built yet).

Institution admin can assign and revoke classroom-level
admin roles for members within their institution.
They can also invite co-institution-admins.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET /v1/institution-admin/:institutionId/admins
Auth: institution admin guard
Returns:
  Institution admins: list from institution_admins table
    with status and approved_at
  Classroom admins: members with role='admin' across all
    classrooms of this institution

POST /v1/institution-admin/:institutionId/admins/invite
Auth: institution admin guard
Body: { email, expiresInDays?: 7 }
Action: same as platform admin invite but initiated by
  institution admin. Sets invited_by = currentUserId.
  Sends invite email via Resend.

PATCH /v1/institution-admin/:institutionId/classroom-admins
Auth: institution admin guard
Body: { userId, classroomId, action: 'promote' | 'demote' }
Action:
  promote: update memberships set role = 'admin'
    where user_id = userId and classroom_id = classroomId
    Notify user: "You have been made an admin of [classroom]"
  demote: update memberships set role = 'student' or 'teacher'
    (revert to their original role — check verification_method
    to determine original role)
    Notify user: "Your admin role in [classroom] has been updated"

Log:
  info: '[INST-ADMIN:roles] promoted' { userId, classroomId }
  info: '[INST-ADMIN:roles] demoted' { userId, classroomId }
  error: '[INST-ADMIN:roles] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  admins/page.tsx

Two sections:

  Institution admins:
    List of approved institution admins with name,
    email, approved date
    "Invite co-admin" button → email input + send
    Cannot remove yourself

  Classroom admins:
    List of all classroom-level admins across all classrooms
    Each row: name + classroom + since date + Demote button
    "Promote member" button → search member + select
    classroom + confirm

Run: npm run test and next build
Commit: "feat: institution admin role management -
promote/demote classroom admins and invite co-admins"
Push.

---

## TASK 06 — Institution admin — batch code management [DONE] — institution_codes already existed with generate personal/batch, CSV import, and status computation (CodesTab) covering nearly all of this task. Added the missing pieces: is_active column + revoke action (034_institution_codes_revoke.sql), classroom filter dropdown (client-side, tagging classroomId per code since no institution-wide list endpoint exists), copy button per row, revoked codes greyed out, and a WhatsApp share button + message on the generated-batch-code panel. Did not add "unlimited" max_uses or "never" expiry — both would require loosening institution_codes' batch_code_cap CHECK constraint and the expires_at NOT NULL constraint, which also feed the atomic redeem_batch_code() RPC; out of scope for a UI-facing task.

Institution admin can generate, view, and revoke invite
codes per classroom. Members use these codes to get
instantly verified when joining.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check if institution_codes table exists from earlier tasks.
If not, create supabase/migrations/031_institution_codes.sql:

  CREATE TABLE IF NOT EXISTS public.institution_codes (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    code text UNIQUE NOT NULL,
    classroom_id uuid REFERENCES public.classrooms(id)
      ON DELETE CASCADE,
    institution_id uuid REFERENCES public.institutions(id)
      ON DELETE CASCADE,
    created_by uuid REFERENCES public.profiles(id),
    max_uses integer DEFAULT 1,
    uses integer DEFAULT 0,
    expires_at timestamptz,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
  );

  ALTER TABLE public.institution_codes ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "institution_codes_admin"
  ON public.institution_codes FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.institution_admins ia
      WHERE ia.user_id = auth.uid()
      AND ia.institution_id = institution_codes.institution_id
      AND ia.status = 'approved'
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND is_platform_admin = true
    )
  );

Add to fileUpdates.md.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET /v1/institution-admin/:institutionId/codes
Auth: institution admin guard
Query: classroomId?, isActive?
Returns: all codes for this institution with usage stats
  { code, classroom, max_uses, uses, expires_at,
    is_active, created_at }
Ordered by created_at DESC

POST /v1/institution-admin/:institutionId/codes
Auth: institution admin guard
Body: { classroomId, maxUses? (default 1, 0 = unlimited),
  expiresInDays? (default 30, null = never) }
Action:
  Generate code: [INST_SLUG]-[YEAR]-[6 random uppercase chars]
  e.g. KVFORTW-2006-X7KP2M
  Insert into institution_codes
Returns: { code, expiresAt }

PATCH /v1/institution-admin/:institutionId/codes/:id/revoke
Auth: institution admin guard
Action: set is_active = false
Returns: updated code

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  codes/page.tsx

Layout:
  "Generate code" button top right
  Filter by classroom dropdown

Code list:
  Each row: code (monospace, copyable) + classroom +
    uses/max_uses + expires_at + status badge +
    Revoke button (if active)
  Copy button next to each code — copies to clipboard
  Revoked codes shown greyed out

Generate code modal:
  Classroom selector (required)
  Max uses: 1 / 10 / 50 / Unlimited
  Expires: 7 days / 30 days / 90 days / Never
  Generate button
  On success: show generated code with large copy button
    and a shareable message:
    "Use code [CODE] to join [Classroom] on AlumTribe"
    WhatsApp share button

Log:
  info: '[INST-ADMIN:codes] generated'
  { institutionId, classroomId, code }
  info: '[INST-ADMIN:codes] revoked' { codeId }
  error: '[INST-ADMIN:codes] failed' { error: full }

Run: npm run test and next build
Commit: "feat: institution admin batch code generation
and management"
Push.

---

## TASK 07 — Institution admin — classroom management [DONE] — List already existed (ClassroomsTab via AdminService.getClassroomsByYear()). Added create (delegates to ClassroomService.createClassroom() via a new ClassroomModule import into InstitutionModule, creatorRole forced to 'admin'), edit, and archive as new InstitutionService methods — deliberately NOT routed through ClassroomService.updateClassroom()/assertClassroomAdmin(), whose own doc comment says school-admin personas do NOT implicitly get that access (a documented SPEC.md §7.2 design choice); this adds a separate, additive institution-wide capability instead of weakening that existing rule. Archived classrooms are read-only — CorridorService.sendMessage() now checks classrooms.archived_at (new column, 035_classroom_archive.sql) and rejects new posts while keeping read access. Added a status Active/Archived tab to ClassroomsTab, distinct from its pre-existing Active/Alumni batch-year filter.

Institution admin can view, create, and archive all
classrooms under their institution.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET /v1/institution-admin/:institutionId/classrooms
Auth: institution admin guard
Query: year?, section?, program?, status?
  (status: active / archived)
Returns: all classrooms for this institution with:
  global_id, name, batch_year, section, program,
  member_count, verified_count, pending_count,
  created_at, status
Ordered by: batch_year DESC, section ASC

POST /v1/institution-admin/:institutionId/classrooms
Auth: institution admin guard
Body: { name, batchYear, section?, program?,
  hasTeacherRoom, requireVerification }
Action:
  Generate global_id using existing generateClassroomId()
  Check for duplicate global_id
  Insert classroom with institution_id
  Auto-add requesting admin as admin member (verified)
Returns: created classroom

PATCH /v1/institution-admin/:institutionId/classrooms/:classroomId
Auth: institution admin guard
Body: { name?, hasTeacherRoom?, requireVerification? }
Updates classroom record.

PATCH /v1/institution-admin/:institutionId/classrooms/:classroomId/archive
Auth: institution admin guard
Action:
  Add archived_at timestamp to classroom
  (add archived_at column if not exists)
  Archived classrooms are read-only — no new messages
Returns: updated classroom

Log:
  info: '[INST-ADMIN:classroom] created' { classroomId, globalId }
  info: '[INST-ADMIN:classroom] archived' { classroomId }
  error: '[INST-ADMIN:classroom] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  classrooms/page.tsx

Layout:
  Filter bar: year selector, search by name/section
  Status tabs: Active / Archived
  "Create classroom" button top right

Classroom list (table on desktop, cards on mobile):
  Each row: global_id, name, batch year, section/program,
    members, verified, pending, actions
  Actions: Edit (inline) | Archive | View classroom

Create classroom modal/drawer:
  Name, batch year, section (letter), program (for colleges),
  Teacher room toggle, Require verification toggle
  Preview of generated global_id as user types
  Submit → POST endpoint above

Archive: confirm dialog "Archive this classroom? Members
  will not lose access but no new messages can be sent."

Run: npm run test and next build
Commit: "feat: institution admin classroom management
- list, create, archive"
Push.

---

## TASK 08 — Institution admin — announcements [DONE] — Genuinely new (no existing overlap). New institution_announcements table (036_institution_announcements.sql). InstitutionService.sendAnnouncement() resolves verified members across all-or-specific classrooms (deduplicated), emits institution.announcement.sent; a new NotificationService handler fans out in-app (full title + 100-char-truncated body) and push (title + "From [Institution]" only, no content) per recipient. "feed_item" requirement satisfied via sendInApp() — this schema has no separate feed_item table (see notification.service.ts's own module comment, same adaptation as TASK 01). Adapted onto a new Announcements tab on /admin rather than a separate route.

Institution admin can broadcast announcements to all
members across all classrooms in their institution,
or to specific classrooms only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create supabase/migrations/032_institution_announcements.sql:

  CREATE TABLE IF NOT EXISTS public.institution_announcements (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    institution_id uuid REFERENCES public.institutions(id)
      ON DELETE CASCADE,
    created_by uuid REFERENCES public.profiles(id),
    title text NOT NULL,
    body text NOT NULL,
    target text CHECK (target IN ('all', 'specific'))
      DEFAULT 'all',
    target_classroom_ids jsonb DEFAULT '[]'::jsonb,
    sent_at timestamptz DEFAULT now(),
    recipient_count integer DEFAULT 0
  );

Add to fileUpdates.md.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET /v1/institution-admin/:institutionId/announcements
Auth: institution admin guard
Returns: all announcements for this institution
  ordered by sent_at DESC

POST /v1/institution-admin/:institutionId/announcements
Auth: institution admin guard
Body: { title, body, target: 'all' | 'specific',
  targetClassroomIds?: uuid[] }
Action:
  If target = 'all':
    Find all verified members across all classrooms
    of this institution (deduplicated by user_id)
  If target = 'specific':
    Find all verified members of the specified classrooms
  For each unique member:
    Create in-app notification:
      type: 'institution_announcement'
      title: announcement title
      body: announcement body (truncated to 100 chars)
      data: { institutionId, announcementId }
    Create feed_item on their home feed
  Update recipient_count
  Return: { announcementId, recipientCount }

Push notifications: send to all recipients via existing
  notification service. Body should NOT reveal full
  content — just title + "from [Institution name]"
  so unverified members see something but not content.

Log:
  info: '[INST-ADMIN:announce] sent'
  { institutionId, announcementId, recipientCount }
  error: '[INST-ADMIN:announce] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  announcements/page.tsx

Layout:
  "New announcement" button top right
  List of past announcements:
    Title + preview + sent date + recipient count
    Read-only — no editing after send

New announcement drawer/modal:
  Title (required, 100 chars)
  Body (required, 1000 chars, rich text optional)
  Target:
    Radio: "All members" / "Specific classrooms"
    If specific: multi-select classroom picker
  Preview of recipient count (fetch on target change)
  "Send announcement" button
  Confirm dialog: "Send to [N] members? This cannot
    be undone."

Run: npm run test and next build
Commit: "feat: institution admin announcements with
institution-wide and targeted broadcast"
Push.

---

## TASK 09 — Institution admin — member management [DONE] — Genuinely new (AdminsTab only covered admin-level members; no institution-wide member search existed). New GET /institution-admin/:institutionId/members(/:userId) on InstitutionService — search is applied in application code (Supabase JS can't ilike an embedded relation's column in one query), fine at this scale. Adapted onto a new Members tab on /admin with filter bar, pagination, and a detail sheet, rather than a separate route.

Institution admin can view all members across all classrooms
under their institution. Search, filter, view profile.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET /v1/institution-admin/:institutionId/members
Auth: institution admin guard
Query:
  classroomId? (filter by specific classroom)
  role? (student / teacher / admin)
  verificationStatus? (pending / verified / rejected)
  search? (name or email, ilike)
  page? (default 0)
  limit? (default 50)
Returns paginated list:
  { id, full_name, email, avatar_url, role,
    verification_status, verification_method,
    joined_at, classroom: { global_id, name } }
Ordered by joined_at DESC

GET /v1/institution-admin/:institutionId/members/:userId
Auth: institution admin guard
Returns: full member profile + all memberships within
  this institution

Log:
  debug: '[INST-ADMIN:members] query'
  { institutionId, filters, count }
  error: '[INST-ADMIN:members] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  members/page.tsx

Filter bar:
  Search input (name or email)
  Classroom dropdown (all classrooms of institution)
  Role filter (All / Students / Teachers / Admins)
  Verification filter (All / Verified / Pending / Rejected)

Member list (table on desktop, cards on mobile):
  Avatar + name + email + classroom + role +
  verification status badge + joined date
  Tap row: opens member detail drawer/sheet showing
  full profile and all classrooms they belong to
  within this institution

Pagination at bottom.

Run: npm run test and next build
Commit: "feat: institution admin member management
with search and filters"
Push.

---

## TASK 10 — Institution admin — verification management [DONE] — VerifyTab already covered document-method/pending-only review with MFA-gated approve/reject + signed document URLs (AdminService, reused as-is). Added the missing breadth: new InstitutionService.listVerifications() across every method/status with classroom filtering and voucher full-name enrichment for peer_vouch rows (vouches jsonb intentionally excludes names — joined at read time). Approve/reject stay on the existing document-specific MFA-gated routes since the other methods (email/peer_vouch/code) resolve themselves without admin review — only document rows get Approve/Reject buttons and bulk-approve checkboxes. Added Pending/Approved/Rejected status tabs and a classroom filter to the existing Verify tab rather than a separate route.

Institution admin can review and approve/reject document
verification requests across all classrooms in their
institution. This replaces the per-classroom admin
verification flow for institution-level admins.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET /v1/institution-admin/:institutionId/verifications
Auth: institution admin guard
Query: status? (pending/approved/rejected), classroomId?,
  method? (document/peer_vouch/etc), page?, limit?
Returns paginated list of verification requests with:
  user details, classroom, method, submitted_at,
  document_url (signed URL if method = document),
  vouches (if method = peer_vouch)
Ordered by: pending first, then by submitted_at ASC

PATCH /v1/institution-admin/:institutionId/verifications/:id/approve
Auth: institution admin guard
Body: { notes? }
Action:
  Update verifications status = 'approved'
  Update memberships verification_status = 'verified'
    verification_method = 'document' (or existing method)
  Notify the member:
    type: 'verification_approved'
    title: "Membership verified ✓"
    body: "You are now verified in [classroom name]"
  Return: updated verification

PATCH /v1/institution-admin/:institutionId/verifications/:id/reject
Auth: institution admin guard
Body: { notes? (reason for rejection, shown to user) }
Action:
  Update verifications status = 'rejected'
  Update memberships verification_status = 'rejected'
  Notify the member:
    type: 'verification_rejected'
    title: "Verification update"
    body: "Your verification for [classroom] needs attention"
  Return: updated verification

Log:
  info: '[INST-ADMIN:verify] approved' { verificationId, userId }
  info: '[INST-ADMIN:verify] rejected' { verificationId, userId }
  error: '[INST-ADMIN:verify] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  verifications/page.tsx

Filter tabs: Pending (with count badge) / Approved / Rejected

Each verification card:
  User avatar + name + email
  Classroom name + global_id
  Verification method badge
  Submitted date
  If document: "View document" button (opens signed URL
    in new tab — document auto-expires after 30 days)
  If peer_vouch: list of vouchers with their names
  Approve button (green) + Reject button (red outline)
  Notes field (optional, shown to rejected members)

Bulk approve: checkbox on each row, "Approve selected"
  button at top for pending verifications.

Empty state for pending: "All verifications are up to date"

Run: npm run test and next build
Commit: "feat: institution admin verification management
with approve, reject and bulk approve"
Push.

---

## TASK 11 — Institution admin — analytics dashboard [PENDING]

Institution admin gets a high-level view of their
institution's activity and growth on AlumTribe.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GET /v1/institution-admin/:institutionId/analytics
Auth: institution admin guard
Returns single object:

  overview:
    total_classrooms: count of all classrooms
    active_classrooms: classrooms with message in last 30 days
    total_members: unique verified members across all classrooms
    total_pending: pending verifications count
    new_members_this_month: members who joined in last 30 days

  classrooms: array of top 10 most active classrooms:
    { global_id, name, member_count, verified_count,
      message_count_30d, last_activity_at }

  verification_stats:
    { pending, approved_this_month, rejected_this_month,
      approval_rate_percent }

  member_growth: array of last 6 months:
    { month (YYYY-MM), new_members, total_members }

Log:
  debug: '[INST-ADMIN:analytics] query' { institutionId }
  error: '[INST-ADMIN:analytics] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create apps/web/app/institution-admin/[institutionId]/
  page.tsx (this is the overview/home of the admin portal)

Layout:

  Top stat cards (2x2 grid):
    Total classrooms
    Total verified members
    Pending verifications (with link to verifications page)
    New members this month

  Most active classrooms (table, top 10):
    Classroom name + members + messages last 30 days
      + last activity
    Tap row → goes to that classroom

  Member growth chart (line chart, last 6 months):
    Use recharts or any charting lib already in the project
    X axis: month, Y axis: member count

  Verification stats:
    Approved this month / Pending / Approval rate %
    Link to verifications page

Keep it clean — no vanity metrics. Only data that helps
the admin take action.

Run: npm run test and next build
Commit: "feat: institution admin analytics dashboard
with overview stats, active classrooms and growth chart"
Push.

---

## COMPLETION SUMMARY

(Claude Code fills this in when all tasks are [DONE])

Date completed:
Tasks completed:
Tests passing:
Build status:
Notes:

---

## RESUMPTION GUIDE

Paste this to resume after any interruption:

"Read TASKS_11.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
