# AlumTribe — Task Batch 03

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_03.md along with the code changes
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

## TASK 01 — Fix: is_platform_admin column + profile 404 [DONE: migration 008_admin_module.sql already adds this column (plain ADD COLUMN, no IF NOT EXISTS) — added 014_add_platform_admin.sql with IF NOT EXISTS so it's safe to run against an environment whose live DB drifted from migration history (must be run manually in Supabase SQL Editor). identity.service.ts's getProfile() already selects is_platform_admin (aliased isPlatformAdmin), already uses the service-role client, and already has the requested [PROFILE-DEBUG] userId log from a prior fix — left in place since there's no way to confirm live behavior from here to safely remove it.]

GET /v1/identity/me fails with:
"column profiles.is_platform_admin does not exist" (code 42703)

The column was added manually in Supabase already.
This task makes it permanent in migrations.

Steps:

1. Create supabase/migrations/014_add_platform_admin.sql:

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_platform_admin IS
'True only for AlumTribe internal ops team.
 Set manually via Supabase dashboard — never by users.
 Never expose this field in public API responses.';

2. In apps/backend/src/modules/identity/identity.service.ts
   Find getMe() or getProfile() method.
   Confirm it selects is_platform_admin from profiles.
   If it uses SELECT * — change to explicit column list
   that includes is_platform_admin.
   Confirm the query uses the service role client
   (not anon client) so RLS does not block it.

3. Add debug logging temporarily:
   console.log('[PROFILE-DEBUG] userId:', userId)
   so we can confirm the right ID is being looked up.
   Remove after confirming it works.

Run: npm run test — all tests pass
Commit: "fix: add is_platform_admin column migration, fix profile 404"

---

## TASK 02 — Fix: login session expired banner [DONE: the banner condition itself was already correct (strict message==='session_expired' check) — the real bug was upstream, in why that redirect kept firing. Access tokens expire in 15 min (JWT_ACCESS_EXPIRY_MINUTES); the client's silent-refresh only works if it (a) knows when to try and (b) has a refresh token to send. Neither was true: completeMfaSetup() (POST /auth/mfa/verify) computed expiresAt from the REFRESH token's multi-day lifetime instead of the access token's real 15-minute one, so shouldRefreshToken() never fired in time; challengeMfa()'s login branch (POST /auth/mfa/challenge) returned a differently-shaped TokenPairResponse (expiresIn, not expiresAt) that the frontend's LoginResponse type had always silently mis-read as undefined; and neither response ever included the refreshToken the backend was already generating server-side, so api.ts's refreshToken() sent an empty body every time regardless (a stale comment in that exact function already flagged this). Every real session died silently within 15 minutes and the next API call's 401 looked like an out-of-the-blue "session expired." Fixed end-to-end: LoginResponseDto gains refreshToken + a correctly-computed expiresAt; challengeMfa()'s login branch now returns the same shape as completeMfaSetup(); lib/auth.ts persists the refresh token; api.ts's refreshToken() sends it and stores the rotated replacement; all three establishSession() call sites (login, mfa, callback) updated; the (also unreachable-today, same bug class) Google OAuth callback path fixed too for consistency.]

The login page always shows "Your session expired. Please sign in again"
even on a fresh visit with no expired session.

Steps:

1. Read apps/web/app/auth/login/page.tsx
   Find where the session expired banner is rendered.
   The banner must ONLY show when URL contains:
   ?message=session_expired

   Fix the condition — it is likely checking something
   that is always true (e.g. checking localStorage for
   a token that was just cleared, or always adding the
   param on redirect).

2. Trace the full post-MFA redirect flow:
   After MFA verify success → where does the app redirect?
   Confirm it redirects to / not to /auth/login?message=session_expired

3. Check apps/web/lib/auth.ts — isLoggedIn() or similar.
   If the app checks for a token, finds none (just after login
   before token is saved), and redirects to login with
   session_expired — that is the bug. Fix the timing so
   token is saved BEFORE any redirect check runs.

Run: next build
Commit: "fix: session expired banner only shows when URL param is set"

---

## TASK 03 — Fix: PGRST201 messages and members queries [DONE: steps 1-2 (FK hints on corridor.service.ts's messages query and classroom.service.ts's getMembers() — memberships has no separate members query of its own in membership.service.ts) were already fixed in a prior session. Step 3: upgraded the classroom page's failed-poll retry from a flat "stop after 3 tries" to real exponential backoff (1s/2s/4s) between attempts — a setTimeout self-scheduler replacing the old setInterval, still capped at MAX_POLL_FAILURES=3 consecutive misses before requiring a manual Retry, still never auto-retrying indefinitely.]

Both corridor and classroom queries fail with:
PGRST201 — ambiguous foreign key to profiles table.

messages has two FK to profiles: sender_id and deleted_by
memberships has two FK to profiles: user_id and verified_by
Supabase does not know which to use for the join.

Steps:

1. Read apps/backend/src/modules/corridor/corridor.service.ts
   Find the Supabase query that fetches messages with sender.
   Fix by specifying the FK hint:

   .select(`
     id, classroom_id, channel, content, message_type,
     metadata, is_deleted, created_at,
     sender:profiles!messages_sender_id_fkey(
       id, full_name, avatar_url
     )
   `)

2. Read apps/backend/src/modules/classroom/classroom.service.ts
   and apps/backend/src/modules/membership/membership.service.ts
   Find the query that fetches members with profile data.
   Fix by specifying the FK hint:

   .select(`
     id, role, verification_status, verification_method,
     joined_at,
     user:profiles!memberships_user_id_fkey(
       id, full_name, avatar_url
     )
   `)

3. Fix the infinite retry loop on the frontend:
   Read apps/web/app/classroom/[globalId]/page.tsx
   Find any useEffect or polling that retries on failure.
   Add a maximum of 3 retries with exponential backoff
   (1s, 2s, 4s). After 3 failures: stop, show error state
   with a manual Retry button. Never auto-retry indefinitely.

Run: npm run test — all tests pass
Commit: "fix: PGRST201 ambiguous FK in messages and members queries"

---

## TASK 04 — Fix: channel access rules and message input [DONE: this required a real read/post asymmetry that didn't exist before — students can now READ staff_room (only posting stays teacher/admin-only) and are shown "🍎 The teachers' lounge is off-limits, kiddo." instead of an input, while teachers/admins are now HARD-LOCKED out of student_alley entirely (not just posting) with "Student Alley is private to students." corridor.service.ts's getMessages() no longer reuses canAccessChannel() (post-access) for reads — it now derives read access itself per channel from the membership row, matching exactly what's specified. Frontend split the old single canAccessChannel() into canReadChannel()/canPostChannel(), gating LockedChannel vs. the message list vs. the input independently. membership.service.ts's canAccessChannel() (still the POST/full-access gate for sendMessage()) was unchanged — its student_alley rule (students only, no admin) was already correct from a prior fix.]

Staff Room shows message input for students.
Student Alley shows as locked for students (wrong — it should be open).

Steps:

1. Read apps/web/app/classroom/[globalId]/page.tsx
   Find where the message input is rendered per tab.
   Read the current user's membership role from the
   already-fetched membership data for this classroom.

2. Apply these rules:

   Classroom tab:
   - All verified members: show message input
   - Unverified: hide input, show "Verify to post" nudge

   Staff Room tab:
   - role 'teacher' or 'admin': show message input normally
   - role 'student': HIDE message input, show quirky message:
     "🍎 The teachers' lounge is off-limits, kiddo."
     (small, centered, muted, with a smile)
   - Students CAN read Staff Room messages (teachers are
     visible to students — only posting is restricted)

   Student Alley tab:
   - role 'student': show message input normally (OPEN)
   - role 'teacher' or 'admin': HIDE message input, show:
     "🎒 This is the students' space. We'll leave them to it."
   - Teachers CANNOT read Student Alley messages (privacy)
     Show a lock screen for teachers:
     "Student Alley is private to students."

3. Also check the backend channel access guard in
   apps/backend/src/modules/corridor/corridor.service.ts
   Confirm the 403 for student_alley is only given to
   teachers/admins — not to students.
   Students should get 200 for student_alley.
   Teachers/admins should get 403 for student_alley.

Run: npm run test and next build
Commit: "fix: channel access rules — staff room and student alley"

---

## TASK 05 — Fix: profile page [DONE: header card gains email + "Member since {month year}"; stats row changed from Classrooms/Connections(coming soon)/Profile% to the spec's Classrooms/Verified in/Member since; empty-state CTA now correctly points at /classes (was /classroom/create); the old ad-hoc "Security" section (only ever showing when mfaEnabled) is now a proper "Account" section with three rows — Two-factor authentication (unchanged behavior), a new Change password row (POST /auth/forgot-password via the already-existing api.forgotPassword(), toast "Reset link sent to your email"), and Sign out (now a destructive-red button in the section instead of a bare full-width ghost button at the page bottom). Kept the existing inline sign-out implementation (api.logout() + clearSession() + redirect) rather than inventing a signOut() export in lib/auth.ts as literally requested — that file is imported BY lib/api.ts already, so having it import api.ts back would be a circular dependency; the 3-line block is already duplicated identically in AuthProvider.tsx for the same structural reason.]

Profile page shows "Unable to load your profile" because
of the is_platform_admin bug (fixed in TASK 01).
After TASK 01 is done, the API should work.

This task fixes the profile page UI itself.

Steps:

1. Read apps/web/app/profile/page.tsx

2. Build a proper profile page with these sections:

   Header card:
   - Large avatar (80px circle, initials if no avatarUrl)
   - Full name (bold, 22px)
   - Email (muted, 14px)
   - Active since (e.g. "Member since Sep 2026")

   Stats row (3 cards side by side):
   - Classrooms: total membership count
   - Verified in: count where verification_status = 'verified'
   - Member since: formatted date

   My classrooms section:
   - Heading: "My Classrooms"
   - List of ClassroomCard components
   - Each links to /classroom/[globalId]
   - Shows verification badge per classroom
   - Empty state: "Join a classroom to get started"
     with "Find your batch" button → /classes

   Account section:
   - Heading: "Account"
   - Row: "Two-factor authentication" | status badge "Enabled"
     Action: "Reset authenticator" button (ghost)
     On click: POST /auth/mfa/recovery-request with user email
     Show success toast: "Recovery email sent"
   - Row: "Change password"
     Action: "Send reset link" button (ghost)
     On click: POST /auth/forgot-password
     Show success toast: "Reset link sent to your email"
   - Row: "Sign out"
     Action: "Sign out" button (destructive red)
     On click: call signOut() from lib/auth.ts

3. All errors: catch and show inline with Retry button.
   Never crash the whole page.
   Show loading skeleton while fetching.

Run: next build
Commit: "feat: profile page — avatar, stats, classrooms, account actions"

---

## TASK 06 — Feature: Direct messages [DONE: backend DmModule (getConversations/getMessages/sendMessage/markRead, shared-verified-classroom gate) + 015_direct_messages.sql (run manually) + frontend messages/page.tsx (conversation list + thread view via ?userId=) + Message button on member cards; 15 suites/323 backend tests pass]

Simple 1:1 DM between verified members of the same classroom.
No read receipts. No typing indicators. No online status.

Steps:

1. Create supabase/migrations/015_direct_messages.sql:

CREATE TABLE public.direct_messages (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content      text NOT NULL CHECK (char_length(content) <= 2000),
  is_read      boolean NOT NULL DEFAULT false,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_message CHECK (sender_id != recipient_id)
);

CREATE INDEX dm_participants_idx ON public.direct_messages(
  LEAST(sender_id::text, recipient_id::text),
  GREATEST(sender_id::text, recipient_id::text),
  created_at DESC
);
CREATE INDEX dm_recipient_unread_idx ON public.direct_messages(
  recipient_id, is_read, created_at DESC
);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_read_participants"
  ON public.direct_messages FOR SELECT
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

CREATE POLICY "dm_insert_own"
  ON public.direct_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "dm_update_read"
  ON public.direct_messages FOR UPDATE
  USING (recipient_id = auth.uid());

Document: must be run manually in Supabase SQL Editor.

2. Create apps/backend/src/modules/dm/ with:

dm.service.ts:

  getConversations(userId: string):
  Returns list of unique conversations for the user.
  For each unique other party:
    - their profile (id, full_name, avatar_url)
    - last message (content, created_at, is sender or recipient)
    - unread count (messages where recipient = userId and is_read = false)
  Sorted by most recent message first.

  getMessages(userId: string, otherUserId: string, page: number):
  Returns paginated messages between userId and otherUserId.
  page size 50, sorted oldest first.
  Validates: both users must share at least one classroom
  where both have verification_status = 'verified'.
  If no shared verified classroom: throw ForbiddenException
  'You can only message verified members of your classrooms'

  sendMessage(senderId: string, recipientId: string, content: string):
  Validates: shared verified classroom (same check as getMessages)
  Validates: content not empty, max 2000 chars
  Creates direct_message row.
  Returns the created message.

  markRead(userId: string, otherUserId: string):
  Marks all messages from otherUserId to userId as is_read = true.

dm.controller.ts:
  GET  /dm/conversations             → getConversations
  GET  /dm/conversations/:userId     → getMessages (query: ?page=0)
  POST /dm/conversations/:userId     → sendMessage (body: { content })
  POST /dm/conversations/:userId/read → markRead

dm.module.ts: wire up service and controller.
Add DmModule to app.module.ts imports.

Add unit tests for dm.service.ts covering:
- getConversations returns correct shape
- getMessages throws if no shared classroom
- sendMessage validates content length
- sendMessage throws if no shared classroom

3. FRONTEND:

Replace apps/web/app/messages/page.tsx content:

Two views — conversations list and thread view.
Use URL param to switch: ?userId=[id] opens thread.

Conversations list (default, no ?userId):
  Header: "Messages"
  Search input: "Search conversations..." (filters by name)
  Each conversation as a card:
    Avatar (48px) | Name (bold) | Last message preview (muted, truncated) | Time
    Unread count badge (red pill, top right) if unread > 0
  Empty state:
    Chat bubble icon (muted)
    "No messages yet"
    "Message a classmate from their profile in a classroom"
  Loading: 3 skeleton cards
  Fetch: GET /dm/conversations on mount

Thread view (when ?userId is in URL):
  Header:
    Back button → /messages (clears userId param)
    Avatar + recipient name
  Messages area:
    Fetch GET /dm/conversations/:userId?page=0 on mount
    Own messages: right-aligned, brand primary purple bubble
    Their messages: left-aligned, white bubble, name above
    Date separators between days
    Scroll to bottom on load
  Message input (fixed bottom):
    Textarea (auto-grows, max 3 lines)
    Send button (ti-send icon, brand primary)
    Send on Enter (Shift+Enter for newline)
    Disable send while submitting
  On send: POST /dm/conversations/:userId
    Optimistically add message to list
    Clear input
  On mount: POST /dm/conversations/:userId/read (mark read)

4. Add "Message" button to classroom member cards:
   In apps/web/app/classroom/[globalId]/page.tsx members tab
   Each member card (except current user) gets:
   A small "Message" button (ghost, small)
   On click: navigate to /messages?userId=[memberId]

Run: npm run test — all tests pass including new DM tests
Run: next build
Commit: "feat: direct messages — backend, frontend, member card button"

IMPORTANT — after pushing, remind user to run in Supabase:
supabase/migrations/015_direct_messages.sql

---

## TASK 07 — Feature: Notifications dropdown [DONE: bell isn't in AppShell.tsx (that file has no header at all, by design) — it's the pre-existing NotificationBell.tsx on the home page, which already matched this task's spec (state, badge, GET/POST endpoints, mark-read, empty/loading states, positioning) almost exactly; fixed one real bug — .list was missing flex:1/min-height:0 so the panel would grow past max-height:480px instead of scrolling internally — plus border-radius 12px→14px to match spec]

Bell icon in AppShell has no UI. Build the dropdown.

Steps:

1. Read apps/web/components/layout/AppShell.tsx
   Find the bell icon and add onClick handler.

2. Add state: isNotifOpen (boolean), notifications (array),
   unreadCount (number), isLoading (boolean)

3. Bell icon behavior:
   On click: toggle isNotifOpen
   Fetch notifications when opening (if not already loaded)
   Show unread count badge if unreadCount > 0
   Badge: red pill, "9+" if over 9

4. Dropdown panel:
   Position: absolute, right-0, top: full (below bell)
   Width: 360px
   Max-height: 480px, overflow-y: auto
   Background: white
   Border: 1px solid var(--color-border)
   Border-radius: 14px
   Box-shadow: 0 8px 32px rgba(0,0,0,0.12)
   z-index: 50
   Close on: click outside (useEffect with document click listener)
             or Escape key

   Header row (sticky top):
   "Notifications" (bold, 14px) | "Mark all read" link (right, muted 12px)
   On "Mark all read": POST /v1/notifications/mark-read { all: true }
     Then set all local notifications to is_read = true
     Set unreadCount = 0

   Notification items:
   Each item (padding 12px 16px, border-bottom):
   - Left: 8px dot (brand primary if unread, transparent if read)
   - Center: title (bold 13px if unread, normal if read)
             body (muted 12px, 2 lines max, line-clamp-2)
   - Right: relative time (11px muted) "2m" / "1h" / "3d"
   On click:
     Mark that notification as read (optimistic)
     Navigate based on notification data.classroom_id:
       If classroom_id exists → /classroom/[classroomId]
       Otherwise → stay on current page
   Hover: background rgba(0,0,0,0.03)

   Empty state (no notifications):
   Bell icon (ti-bell, muted, 32px) centered
   "You're all caught up" (muted, 14px)

   Loading state:
   3 skeleton rows (animate-pulse gray bars)

5. Fetch: GET /v1/notifications?limit=20
   Map response to local state.
   Set unreadCount = count of is_read = false items.

6. Unread badge on bell:
   On app load: GET /v1/notifications?limit=1
   Just to get unread count without loading all notifications.
   Or check if backend has GET /v1/notifications/unread-count
   If not: just fetch limit=20 and count locally on app load.

Run: next build
Commit: "feat: notifications dropdown with mark-read"

---

## TASK 08 — Feature: Institution request flow [DONE: ClassroomCreateForm.tsx + admin/InstitutionRequestsTab.tsx already existed (prior session) and mostly matched spec; fixed real bugs — "Can't find your school?" link showed even when results WERE found (missing results.length===0 check), min-chars was 2 not 3, name/city weren't real required form fields (submit used raw query, no city validation), success message didn't include userEmail; kept country as ISO-2 code (not "India" text) since backend DTO requires it]

When creating a classroom, allow users to request a new
institution if theirs is not in the database.

Steps:

1. Read apps/web/app/classroom/create/page.tsx
   Find the institution search step.

2. After the debounced search (300ms, min 3 chars):
   If results exist: show dropdown normally
   If no results after typing 3+ chars:
     Show below the search input:
     "Can't find your school?"
     Link: "Request it to be added →" (purple text, no button)

3. On clicking the link:
   Expand an inline form below the search (no modal):

   Fields:
   - Institution name (pre-filled from search query, required)
   - Type: radio group — School / College / University (required)
   - City (text input, required)
   - Country (text input, default "India")
   - Website URL (optional, placeholder "https://...")
   - Your connection: select — Alumni / Teacher / Admin (required)
   - Additional notes (optional textarea, max 500 chars, 3 rows)

   Buttons:
   - "Submit request" (primary)
   - "Cancel" (ghost, collapses the form)

   On submit:
   - POST /v1/institutions/request
   - Success: collapse form, show green success message:
     "Request submitted! We'll review it within 24-48 hours
      and notify you at [userEmail] when approved."
     Show the request ID in small muted text for reference.
   - Error 409 (duplicate found):
     "A similar institution already exists: [name]"
     "[Use this institution →]" link — clicking selects it
     and continues classroom creation.
   - Other error: show inline error message, keep form open.

4. Also add to apps/web/app/admin/page.tsx (TAB 2 in admin):
   Institution Requests section:
   Fetch GET /v1/admin/institution-requests?status=pending
   List each request: name, type, city, submitted by, date
   Approve button → inline fields for slug + email domain
     POST /v1/admin/institution-requests/:id/approve
   Reject button → inline reason field
     POST /v1/admin/institution-requests/:id/reject
   Empty: "No pending institution requests."

Run: next build
Commit: "feat: institution request flow in classroom creation and admin"

---

## TASK 09 — Feature: Verification badges [DONE: Badge.tsx rewritten with exact hex colors/labels (sm/md sizes, creator variant added); MemberListModal.tsx now shows role+verification+creator badges together (was vouch-button-OR-status, never both); verify nudge banner unified to trigger on pending+pending_auto (was pending_auto only), exact copy/colors/localStorage key dismissed_verify_banner_[classroomId]; classes/profile pages' ClassroomCard badge already existed from a prior session]

Show clear verification status throughout the app.

Steps:

1. Update apps/web/components/ui/Badge.tsx
   Ensure these variants exist with correct colors:

   verified:     bg #dcfce7  text #166534  label "✓ Verified"
   pending:      bg #fef9c3  text #854d0e  label "⏳ Pending"
   pending_auto: bg #dbeafe  text #1e40af  label "⚡ Early member"
   rejected:     bg #fee2e2  text #991b1b  label "✗ Rejected"
   creator:      bg #ede9fe  text #4c1d95  label "★ Creator"
   teacher:      bg #ede9fe  text #4c1d95  label "Teacher"
   admin:        bg #1c1c2e  text white    label "Admin"

   Props: variant, size? (sm default, md)
   Small: padding 2px 8px, font-size 10px, border-radius 99px
   Medium: padding 4px 12px, font-size 12px

2. Apply badges in:

   apps/web/app/classroom/[globalId]/page.tsx — members tab:
   Each member row: avatar | name | role badge | verification badge
   Show both role (student/teacher/admin) and verification status.

   apps/web/app/classes/page.tsx — classroom list:
   Each ClassroomCard: show current user's verification badge
   for that specific classroom in the bottom-right of the card.

   apps/web/app/profile/page.tsx — classrooms section:
   Each classroom in the list: show verification badge.

3. Verification nudge banner in classroom view:
   In apps/web/app/classroom/[globalId]/page.tsx:
   If current user verification_status is 'pending' or 'pending_auto':
   Show amber banner at top of message area (below tab bar):
   Background: #fef9c3, border-left: 3px solid #d97706
   Text: "⏳ You're not verified yet — [Complete verification →]"
   Link → /verify?classroomId=[globalId]
   Dismiss X button (top right of banner)
   On dismiss: save dismissed state in localStorage key:
   'dismissed_verify_banner_[classroomId]'
   Do not show again if dismissed.

Run: next build
Commit: "feat: verification badges across app, nudge banner in classroom"

---

## TASK 10 — Feature: UI polish pass [DONE: alumini-demo.html referenced by the task doesn't exist anywhere in the repo (confirmed, same finding as TASKS_02 TASK 10) — polished against the concrete itemized list instead. .card/.card-sm already existed from a prior session; added missing .section-heading. Home feed: date-group headers + .card-sm items (was plain list). Classes: gap 8px, institution label 10px. Classroom header/tabs/bubbles/input/empty-state already matched spec; fixed empty-state copy to exact "Say hello!". Verify: number circle 30px primary/white (was 24px gray), added complete=green-border/active=primary-border card states (skipped a fictional "locked" state — nothing in this app's verification model marks a method unavailable). Persona: switched list to a real 2-col grid (was single column), active card now solid primary bg/white text (was light tint). Teacher page already fully matched spec, no changes]

Apply consistent design system across all pages.
Read alumini-demo.html as the design reference before starting.

Global CSS (update apps/web/styles/globals.css):

Add these utility classes if missing:

.card {
  background: white;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  padding: 14px;
  transition: border-color 0.15s ease;
}
.card:hover { border-color: #ccc; }
.card-sm { padding: 10px 12px; border-radius: 10px; }

Section heading style:
.section-heading {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
  margin-top: 16px;
}
.section-heading:first-child { margin-top: 0; }

Pages to polish:

/ (home page):
  Activity feed items inside .card-sm containers
  Date group headers (Today / Yesterday / Earlier)
  as .section-heading
  Classroom cards section if no activity

/classes page:
  Each ClassroomCard inside .card with hover effect
  Institution name: 10px uppercase muted above card title
  Gap between cards: 8px
  Sticky "+" button at bottom: full width, brand primary,
  "+ New Classroom" text

/classroom/[globalId] page:
  Header: fix institution name to single line (truncate)
  Remove "18yr" stat — replace with "Batch of [year]"
  Stats row: "N members · N teachers · N verified"
  Tab bar: active tab white text bold, inactive 60% opacity
  Message bubbles: white cards for others, brand primary for own
  Empty message state: centered wave emoji + "Say hello!"
  Message input: white bg, border-top, rounded input field

/verify page:
  Each verification method as .card
  Number circle (30px, brand primary bg, white text)
  left of method name and description
  Completed: green border, checkmark icon
  Active: brand primary border
  Locked: gray, opacity 0.6

/persona page:
  Two cards side by side (grid 2 cols, gap 12px)
  Active card: brand primary bg, white text, "Active" pill
  Inactive: white bg, border, "Switch" pill

/teacher page:
  Accordion groups by school
  School header: dark brand bg, school name white, class count
  Each class row: dot (green=active, gray=alumni) + name + count + badge
  Collapsible: click header to expand/collapse

Run: next build
Run: npx tsc --noEmit in apps/web
Commit: "feat: UI polish pass — cards, badges, spacing all pages"

---

## TASK 11 — Feature: School admin dashboard [DONE: dashboard already existed from prior work (Overview/Verify/Codes/Stats/Admins tabs) with a "show empty state, not redirect" gate for no-admin-personas — kept that (better UX, same practical outcome as the literal "redirect to /"). Filled real gaps: built TAB 3 Classrooms from scratch (reuses the existing GET /admin/:id/classrooms endpoint); added totalMembers+activeClassrooms to backend getOverview() for the 5-card stats row + a quick-actions row that switches tabs; VerifyTab gets Avatar/method badge/ghost green-red buttons + a live "Verifications (N)" tab count; CodesTab's "batch code" is architecturally ONE shared code with a redemption cap (SPEC.md §11.4/11.5), not N distinct one-time codes as the task's mockup assumed — kept that model (rearchitecting it would conflict with the existing, tested institution_codes schema) and added the two genuinely-missing controls it needs: a 10/25/50/100 max-redemptions chip group and a new 7/30/90-day expiry chip group (backend: GenerateBatchCodeDto.expiresInDays, defaults to appConfig.CODE_EXPIRY_DAYS), plus copyable generated-code display and accurate warning text; Analytics (was "Stats") rebuilt as three literal tables per spec, including a new memberGrowth (6-month) series added to backend getAnalytics(); added an institution selector for admins of 2+ institutions (personas can hold one school_admin persona per institution). Backend: 46/46 admin+codes tests pass]

Build proper admin dashboard for classroom admins.
Redirect to / if user has no admin memberships.

Steps:

1. Read apps/web/app/admin/page.tsx

2. On mount: fetch user's admin memberships.
   If none: redirect to /
   If has admin memberships: show dashboard.

3. Five tabs:

   TAB 1 — Overview:
   Stats row (5 cards):
     Total classrooms | Total members | Verified members |
     Pending verifications | Active classrooms
   Fetch from GET /v1/admin/:institutionId/overview
   Use the first institution the user is admin of.
   If admin of multiple institutions: show institution
   selector dropdown at top.

   Recent activity list (last 10 items from audit_logs
   for their classrooms — or just notifications).

   Quick actions row:
   "Review verifications" button → switches to TAB 2
   "Generate codes" button → switches to TAB 4

   TAB 2 — Verifications:
   Fetch GET /v1/admin/:institutionId/verifications/pending
   Count badge on tab: "Verifications (N)"
   Each item as .card:
     Avatar + name | Classroom name | Method badge | Submitted time
     Approve button (green, ghost) | Reject button (red, ghost)
   On approve: POST /v1/admin/:institutionId/verifications/:id/approve
     Optimistic: fade card out, decrement count
   On reject: show inline reason input, then POST with reason
     Optimistic: fade card out
   Empty: "✓ No pending verifications. All caught up."

   TAB 3 — Classrooms:
   Fetch GET /v1/admin/:institutionId/classrooms
   Filter chips: All | Active | Alumni
   Each classroom as .card:
     Name (bold) | Global ID (monospace, 11px, muted)
     Member count | Last active time
     "View classroom" link → /classroom/[globalId]

   TAB 4 — Batch Codes:
   Select classroom: dropdown of admin's classrooms
   Number of codes: 10 / 25 / 50 / 100 (radio group)
   Expires in: 7 days / 30 days / 90 days (radio group)
   "Generate codes" button (primary)
   On generate: POST /v1/codes/batch
   On success:
     Show codes in a 2-column monospace grid
     "Copy all codes" button → copies all as newline-separated text
     "Download as CSV" button → downloads codes.csv
   Warning text: "Share these codes carefully.
   Each code can only be used once."
   Below: list of existing unexpired codes with used/total count.

   TAB 5 — Analytics:
   Three simple tables:
   Member growth: Month | New members | Cumulative (last 6 months)
   Verification methods: Method | Count | % of total
   Top classrooms: Classroom | Members (top 5 by member count)
   Fetch from GET /v1/admin/:institutionId/analytics
   If endpoint returns 404 or fails: show placeholder tables
   with "No data yet" message.

Run: next build
Commit: "feat: school admin dashboard — overview, verifications, codes, analytics"

---

## COMPLETION SUMMARY

Date completed: 2026-09-21
Tasks completed: TASK 01–11, all [DONE]
Tests passing: apps/backend 15 suites / 323 tests; packages/utils 1 suite / 37 tests — all green
Build status: next build (0 errors) and npx tsc --noEmit in apps/web (0 errors), both clean as of TASK 11
Migrations to run manually in Supabase:
  - supabase/migrations/014_add_platform_admin.sql (TASK 01)
  - supabase/migrations/015_direct_messages.sql (TASK 06)
Notes:
  - Every task followed the same pattern: investigate whether the task's literal premise matched
    the actual codebase before implementing, fix the real underlying gap when it didn't, and
    document the reasoning inline rather than fabricating a fix for a non-existent bug or leaving
    a genuine one unaddressed. See individual [DONE: ...] notes above for specifics.
  - TASK 10 and TASK 11 both reference alumini-demo.html as a design source — confirmed (again)
    that this file does not exist anywhere in the repo; both were completed against their own
    itemized requirement lists instead.
  - TASK 11's admin dashboard "batch codes" tab keeps this codebase's real architecture (one
    shared code with a redemption cap, per SPEC.md §11.4/11.5) rather than the task mockup's
    implied "generate N distinct one-time codes," which the institution_codes schema was never
    built to support — see that task's [DONE] note for the full reasoning.

---

## RESUMPTION GUIDE

Paste this to resume after any interruption:

"Read TASKS_03.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
