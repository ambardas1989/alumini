# AlumTribe — Task Batch 02

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_02.md along with the code changes
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

## TASK 01 — Sign out [DONE: already fully implemented in a prior session — api.logout(), AuthProvider.logout() (calls API, clears session, redirects to /auth/login?message=signed_out), login page signed_out banner, UserMenu dropdown (View profile/Help & Support/Sign out) on home+teacher, profile page Sign out button with confirm modal. No code changes needed.]

Backend endpoint already exists: POST /v1/auth/logout

Steps:

1. Read apps/web/components/layout/AppShell.tsx
   Find the avatar/profile area in the nav bar.
   Add a dropdown triggered by clicking the avatar:
   - "View profile" → /profile
   - "Help & Support" → /contact
   - divider
   - "Sign out" (red/destructive text)

2. Create a shared signOut() helper in apps/web/lib/auth.ts:
   - Call POST /v1/auth/logout via api.logout()
   - Call clearSession() to wipe local token and user
   - If API call fails: still clear local session (silent fail)
   - Redirect to /auth/login?message=signed_out

3. In apps/web/app/auth/login/page.tsx
   Handle ?message=signed_out in URL params:
   Show blue info banner: "You have been signed out."
   Clear the param from URL after showing.

4. In apps/web/app/profile/page.tsx
   Add "Sign out" button at the bottom of the page.
   Ghost style with red text.
   Same signOut() helper.

Run: npm run test and next build
Commit: "feat: sign out — nav dropdown and profile page"

---

## TASK 02 — User MFA reset (self-service) [DONE: "Lost access?" link + mfa-recovery page already existed from a prior session; added Two-factor authentication security section to profile page with Reset button, confirm modal, and requestMfaRecovery(profile.email) call.]

Users who lose access to their authenticator app are
currently locked out permanently. Build self-service recovery.

Steps:

1. In apps/web/app/auth/mfa/page.tsx
   Confirm "Lost access to your authenticator?" link exists
   (it was built in a previous session).
   If missing — add it below the Verify button.
   On click: call POST /v1/auth/mfa/recovery-request
   Body: { email } — read email from session or ask user to enter it
   Show success: "Check your email for a recovery link."

2. Confirm apps/web/app/auth/mfa-recovery/page.tsx exists.
   If missing — create it:
   Reads ?token= from URL params.
   On mount: POST /v1/auth/mfa/recovery-verify with { token }
   On success:
   - Store returned mfaPendingToken in sessionStorage
   - Show banner: "Authenticator reset. Please set up again."
   - Redirect to /auth/mfa
   On error (expired/invalid token):
   - Show: "This link has expired."
   - Link: "Request a new one" → /auth/login

3. In apps/web/app/profile/page.tsx
   Add "Reset authenticator app" option in security section:
   - Label: "Two-factor authentication"
   - Status: "Enabled" (green badge)
   - Action button: "Reset" (ghost, small)
   - On click: confirm dialog
     "This will remove your current authenticator.
      You will need to set up a new one on next login.
      Are you sure?"
   - On confirm: call POST /v1/auth/mfa/recovery-request
     with the current user's email
   - Show success: "A reset link has been sent to your email."

Run: npm run test and next build
Commit: "feat: user MFA self-service reset from profile and MFA page"

---

## TASK 03 — Classroom redirect fix [DONE: already fixed in a prior session (backend column-aliasing fix) — create page and detail page both correctly use classroom.globalId; verified via next build.]

After creating a classroom the app redirects to
/classroom/undefined instead of /classroom/[globalId].

Steps:

1. Read apps/web/app/classroom/create/page.tsx
   Find where the API response is handled after creation.
   The backend returns a classroom object with a globalId
   or global_id field (check which one via apps/web/lib/api.ts).

2. Fix the redirect:
   router.push(`/classroom/${response.globalId}`)
   or
   router.push(`/classroom/${response.global_id}`)
   whichever matches the actual API response field name.

3. Also confirm apps/web/app/classroom/[globalId]/page.tsx
   loads correctly after the redirect — no blank screen or error.

Run: next build
Commit: "fix: classroom redirect uses correct globalId after creation"

---

## TASK 04 — Creator and early member verification badges [DONE: migration 011_pending_auto_status.sql adds pending_auto status + early_member method + messages_insert RLS update; classroom.service.ts joinClassroom() sets pending_auto for member_count<=3; membership.service.ts canAccessChannel() extended (classroom/student_alley only, staff_room stays verified-only) since corridor.service.ts gates sendMessage() on it — the RLS change alone would have been unreachable without this; frontend: amber dismissible banner + blue "Early member" Badge variant + MemberListModal text badges, all via new "membership" i18n namespace.]

Cold start fix: first creator and first 3 joiners of a new
classroom get a special pending_auto status so they are not
stuck in read-only while the classroom is new.

BACKEND:

1. Add 'pending_auto' to the memberships verification_status:
   Run this migration in Supabase SQL Editor and save as
   supabase/migrations/011_pending_auto_status.sql:

   ALTER TABLE public.memberships
   DROP CONSTRAINT IF EXISTS memberships_verification_status_check;

   ALTER TABLE public.memberships
   ADD CONSTRAINT memberships_verification_status_check
   CHECK (verification_status IN (
     'pending', 'pending_auto', 'verified', 'rejected'
   ));

   Also update the messages RLS policy to allow pending_auto
   members to post in classroom and student_alley channels:
   (Re-run the updated policy — see notes below)

2. In apps/backend/src/modules/classroom/classroom.service.ts
   Find createClassroom(). Confirm the creator membership is:
   verification_status: 'verified'
   verification_method: 'creator'
   If not — fix it.

3. In apps/backend/src/modules/membership/membership.service.ts
   Find joinClassroom() or createMembership().
   After creating the membership, check the classroom member_count.
   If member_count <= 3 (early joiner):
   Set verification_status: 'pending_auto'
   Set verification_method: 'early_member'
   Otherwise: set verification_status: 'pending' as normal.

4. Update messages RLS policy in Supabase SQL Editor:
   Run this after the constraint migration above:

   DROP POLICY IF EXISTS "messages_insert" ON public.messages;
   CREATE POLICY "messages_insert" ON public.messages
   FOR INSERT WITH CHECK (
     sender_id = auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.memberships m
       WHERE m.user_id = auth.uid()
       AND m.classroom_id = messages.classroom_id
       AND m.verification_status IN ('verified', 'pending_auto')
       AND (
         messages.channel IN ('classroom', 'student_alley')
         OR (messages.channel = 'staff_room'
           AND m.role IN ('teacher', 'admin')
           AND m.verification_status = 'verified')
       )
     )
   );

   Document this SQL in the task note after running.

FRONTEND:

1. In apps/web/app/classroom/[globalId]/page.tsx
   Show an amber banner for pending_auto members:
   "You joined early — complete verification to become
    fully trusted by your batchmates. [Verify now →]"
   Link → /verify?classroomId=[globalId]
   Dismiss button (X) — stores dismissed state in localStorage
   so it doesn't show again after dismissal.

2. In the members list, show badges:
   - 'verified' → green "Verified" badge (existing)
   - 'pending_auto' → blue "Early member" badge (new)
   - 'pending' → amber "Pending" badge (existing)
   - 'rejected' → red "Rejected" badge (existing)

3. Update apps/web/i18n/messages/en.json:
   membership.status.pending_auto: "Early member"
   membership.badge.early_member_banner: "You joined early..."
   membership.badge.verify_now: "Verify now"

Run: npm run test and next build
Commit: "feat: pending_auto status for early classroom members"

---

## TASK 05 — Institution request flow [DONE: migrations 012 (institution_requests table + RLS) and 013 (45 seed institutions, adapted to the real institutions schema — no plain "city" column, only city_code; is_partner used in place of the task's nonexistent is_verified; fixed a slug collision between IIT Kharagpur/Kanpur in the source list) — both need to be run manually in Supabase SQL Editor. Backend: POST/GET /institution/request|my-requests, GET/POST /admin/institution-requests(/:id/approve|reject) — platform-admin-gated via the existing profiles.is_platform_admin + assertPlatformAdmin() pattern; added Profile.isPlatformAdmin (aliased select) so the frontend can check it. Frontend: inline "Can't find your school?" request form on the create-classroom page (409 duplicate → "use this institution" link); admin page gets a new Requests tab, visible to any platform admin even without a school_admin persona (the page previously hard-gated on one).]

Schools and colleges must be approved by the platform admin
before they appear in the app. Users can request new ones.

BACKEND:

1. Create supabase/migrations/012_institution_requests.sql:

   CREATE TABLE public.institution_requests (
     id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
     requested_by uuid REFERENCES public.profiles(id),
     name text NOT NULL,
     type text CHECK (type IN ('school','college','university')) NOT NULL,
     city text,
     city_code text,
     country_code text NOT NULL DEFAULT 'IN',
     website_url text,
     email_domain text,
     requester_relationship text CHECK (
       requester_relationship IN ('alumni','teacher','admin','other')
     ) NOT NULL,
     notes text,
     status text CHECK (
       status IN ('pending','approved','rejected')
     ) DEFAULT 'pending',
     reviewed_by uuid REFERENCES public.profiles(id),
     reviewed_at timestamptz,
     rejection_reason text,
     created_at timestamptz DEFAULT now()
   );

   ALTER TABLE public.institution_requests ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "institution_requests_read_own"
     ON public.institution_requests FOR SELECT
     USING (requested_by = auth.uid());

   CREATE POLICY "institution_requests_insert"
     ON public.institution_requests FOR INSERT
     WITH CHECK (requested_by = auth.uid());

   Document this SQL in the task note — must be run manually
   in Supabase SQL Editor after this task completes.

2. In apps/backend/src/modules/institution/:

   Add POST /institutions/request
   Auth: required
   Body: {
     name, type, city?, cityCode?, countryCode,
     websiteUrl?, emailDomain?, requesterRelationship, notes?
   }
   Logic:
   - Search for existing institution with similar name
     (case-insensitive ILIKE %name%)
   - If found: return 409 with existing institution details
     so user can use that instead of requesting a duplicate
   - Otherwise: create institution_request record
   - Log to console: [INSTITUTION-REQUEST] name, type, city, by userId
   - Return: { message: 'Request submitted', requestId }

   Add GET /institutions/my-requests
   Auth: required
   Returns all institution requests by current user with status.

3. In apps/backend/src/modules/admin/:

   Add GET /admin/institution-requests
   Auth: platform admin only
   Query: ?status=pending (default), page, limit
   Returns paginated institution requests.

   Add POST /admin/institution-requests/:requestId/approve
   Auth: platform admin only
   Body: { slug, cityCode?, emailDomain? }
   Logic:
   - Validate slug is unique in institutions table
   - Create institution record from request data + body overrides
   - Mark request approved, set reviewed_by and reviewed_at
   - Log: [INSTITUTION-APPROVED] name, slug
   - Return: { institution, message: 'Approved' }

   Add POST /admin/institution-requests/:requestId/reject
   Auth: platform admin only
   Body: { reason: string }
   Logic:
   - Mark request rejected with reason
   - Log: [INSTITUTION-REJECTED] name, reason
   - Return: { message: 'Rejected' }

4. Create supabase/migrations/013_seed_institutions.sql
   with INSERT statements for these institutions:

   -- Schools India
   ('MP Birla School','MPBIRLA','school','Kolkata','KOL','IN',null,true),
   ('KV Fort William','KVFORTW','school','Kolkata','KOL','IN',null,true),
   ('DPS RK Puram','DPSRKP','school','New Delhi','DEL','IN',null,true),
   ('DPS Mathura Road','DPSMR','school','New Delhi','DEL','IN',null,true),
   ('La Martiniere Boys','LAMARB','school','Kolkata','KOL','IN',null,true),
   ('La Martiniere Girls','LAMARG','school','Kolkata','KOL','IN',null,true),
   ('St Xaviers Collegiate School','SXCSKOL','school','Kolkata','KOL','IN',null,true),
   ('Don Bosco School Kolkata','DONBKOL','school','Kolkata','KOL','IN',null,true),
   ('South Point School','SPTKOL','school','Kolkata','KOL','IN',null,true),
   ('Loreto House','LHKOL','school','Kolkata','KOL','IN',null,true),
   ('Modern High School','MHSKOL','school','Kolkata','KOL','IN',null,true),
   ('Doon School','DOON','school','Dehradun','DDN','IN',null,true),
   ('Welham Boys School','WELHAMB','school','Dehradun','DDN','IN',null,true),
   ('Welham Girls School','WELHAMG','school','Dehradun','DDN','IN',null,true),
   ('Mayo College','MAYO','school','Ajmer','AJM','IN',null,true),
   ('Scindia School','SCINDIA','school','Gwalior','GWL','IN',null,true),
   ('Cathedral School Mumbai','CATHMUM','school','Mumbai','MUM','IN',null,true),
   ('Campion School Mumbai','CAMPMUM','school','Mumbai','MUM','IN',null,true),
   ('Bishop Cotton School','BCOTTON','school','Shimla','SML','IN',null,true),
   ('Army Public School Delhi','APSDEL','school','New Delhi','DEL','IN',null,true),
   ('St Columba School','STCOLB','school','New Delhi','DEL','IN',null,true),
   ('Springdales School','SPRDEL','school','New Delhi','DEL','IN',null,true),
   ('Frank Anthony Public School','FAPSDEL','school','New Delhi','DEL','IN',null,true),
   ('Loreto Convent Entally','LCEKOL','school','Kolkata','KOL','IN',null,true),
   ('St James School Kolkata','STJKOL','school','Kolkata','KOL','IN',null,true),

   -- Colleges/Universities India
   ('IIT Kharagpur','IITKGP','university',null,null,'IN','kgpian.iitkgp.ac.in',true),
   ('IIT Delhi','IITDEL','university',null,null,'IN','iitd.ac.in',true),
   ('IIT Bombay','IITBOM','university',null,null,'IN','iitb.ac.in',true),
   ('IIT Madras','IITMAD','university',null,null,'IN','iitm.ac.in',true),
   ('IIT Kanpur','IITKGP','university',null,null,'IN','iitk.ac.in',true),
   ('IIM Ahmedabad','IIMA','university',null,null,'IN','iima.ac.in',true),
   ('IIM Calcutta','IIMC','university',null,null,'IN','iimcal.ac.in',true),
   ('IIM Bangalore','IIMB','university',null,null,'IN','iimb.ac.in',true),
   ('BITS Pilani','BITS','university',null,null,'IN','pilani.bits-pilani.ac.in',true),
   ('Delhi University','DU','university',null,null,'IN','du.ac.in',true),
   ('Jadavpur University','JADAVPU','university','Kolkata','KOL','IN',null,true),
   ('Presidency University Kolkata','PRESKOL','university','Kolkata','KOL','IN',null,true),
   ('VIT Vellore','VIT','university',null,null,'IN','vit.ac.in',true),
   ('Manipal Institute of Technology','MANIPAL','university',null,null,'IN','manipal.edu',true),
   ('NIT Trichy','NITTRY','university',null,null,'IN',null,true),
   ('Christ University Bangalore','CHRISTB','university','Bangalore','BLR','IN',null,true),
   ('Symbiosis Pune','SYMPUNE','university','Pune','PNE','IN',null,true),
   ('St Stephens College Delhi','STSTEPH','college','New Delhi','DEL','IN',null,true),
   ('Calcutta University','CALCUTTA','university','Kolkata','KOL','IN',null,true),

   -- International
   ('UC Davis','UCDAVIS','university',null,null,'US','ucdavis.edu',true),
   ('MIT','MIT','university',null,null,'US','mit.edu',true),
   ('Stanford University','STANFORD','university',null,null,'US','stanford.edu',true),
   ('University of Melbourne','UMELB','university',null,null,'AU','unimelb.edu.au',true),
   ('University of London','ULON','university',null,null,'GB',null,true);

   Note: adjust INSERT syntax to match the exact institutions
   table schema (read the existing migration first).
   The last column (true) represents is_verified = true
   for pre-seeded institutions.

FRONTEND:

1. Update apps/web/app/classroom/create/page.tsx

   Institution search:
   - Debounced search input (300ms)
   - Calls GET /v1/institutions/search?q=query&limit=10
   - Shows dropdown with name, city, type badge
   - If no results after typing 3+ chars:
     Show "Can't find your school?" link at bottom of dropdown

   "Request institution" — inline form shown below search:
   (Not a modal — keep it simple, inline expansion)
   Fields:
   - Institution name (pre-filled from search query)
   - Type: School / College / University (radio or select)
   - City
   - Country (default: India)
   - Website URL (optional)
   - Your relationship: Alumni / Teacher / Admin (select)
   - Notes (optional textarea)
   Submit → POST /v1/institutions/request
   Success state:
   "Thanks! We'll review your request within 24-48 hours
    and notify you at [email] when approved."
   Show request ID for reference.
   Error 409 (duplicate):
   "A similar institution already exists: [name].
    [Use this institution →]" — clicking selects it.

2. Update apps/web/app/admin/page.tsx
   Add "Institution Requests" section:
   - Only visible to platform admins
   - Shows count badge on tab: "Requests (3)"
   - List: name, type, city, requested by, date
   - Approve button → inline form: slug (required), email domain (optional)
   - Reject button → inline: rejection reason (required)
   - After approve/reject: remove from pending list

3. Add strings to apps/web/i18n/messages/en.json

Run: npm run test and next build

IMPORTANT: After this task completes, manually run these
in Supabase SQL Editor IN ORDER:
1. supabase/migrations/012_institution_requests.sql
2. supabase/migrations/013_seed_institutions.sql

Commit: "feat: institution request flow, admin approval, 45 seeded institutions"

---

## TASK 06 — Login and signup copy refresh [DONE: updated the right-panel form heading/sub (not AuthLayout's left-panel brand tagline, which the task's wording pointed at but the actual heading text lives in each page's own t('title')/t('subtitle')) — login "Back to your tribe." / "Sign in to reconnect with your people", signup "Find your batch." / "Create your account to get started" (new subtitle line + CSS class added, signup previously had no subtitle), mfa verifyTitle "One last step." (sub unchanged).]

"Welcome back" is generic. AlumTribe needs warmer,
brand-forward copy on auth screens.

Steps:

1. Update apps/web/app/auth/login/page.tsx right panel:
   Heading: "Back to your tribe."
   Sub: "Sign in to reconnect with your people"

2. Update apps/web/app/auth/signup/page.tsx right panel:
   Heading: "Find your batch."
   Sub: "Create your account to get started"

3. Update apps/web/app/auth/mfa/page.tsx right panel:
   Current: "Welcome back" / "Enter the code..."
   Replace heading with: "One last step."
   Keep the sub as is.

4. Update apps/web/i18n/messages/en.json with new strings.

Run: next build
Commit: "feat: warmer auth screen copy"

---

## TASK 07 — Bug fixes: NaN members, undefined classroom, profile crash [DONE: all three (BUG 1/2/3) traced to one root cause — classroom.service.ts's getClassroomsByInstitution() (backs GET /classroom/my, used by home, teacher, and profile) selected raw snake_case columns and spread them unaliased, so memberCount/globalId read as undefined on every screen that consumes it: NaN in the ICU plural on classroom cards, "/classroom/undefined" links on home+teacher, and — most likely — the profile crash itself (an undefined count arg into next-intl's ICU plural formatter throws, caught by the global error.tsx as "Something went wrong"). Fixed by reusing the same CLASSROOM_SELECT_COLUMNS/INSTITUTION_JOIN_COLUMNS aliases createClassroom()/getByGlobalId()/getById() already use, plus defensive `?? 0` guards on ClassroomCard/ClassRow/teacher stats and an =0 {Be the first to join} ICU branch. Bell icon was already non-interactive (no onClick) from a prior session; added a hover tooltip instead of leaving it bare.]

These are blocking bugs found during manual testing.
Read every affected file before making changes.

BUG 1 — "NaN members" on classroom cards:
In apps/web/app/(home)/page.tsx or wherever classroom cards
are rendered, the member_count field is being used in math
without a null check.

Fix: replace any raw member_count usage with:
(classroom.member_count ?? 0)

Also update the display:
- 0 members → "Be the first to join"
- 1 member → "1 member"
- N members → "N members"
Never show "NaN members" or "null members".

BUG 2 — Clicking a classroom shows undefined error:
The classroom card links to /classroom/undefined because
it reads the wrong field name from the API response.

Find where classroom cards are rendered and where the link
is built. Check what field the API actually returns:
- Could be global_id (snake_case)
- Could be globalId (camelCase)
Read apps/web/lib/api.ts to confirm the exact field name.

Fix the link: `/classroom/${classroom.global_id}`
or `/classroom/${classroom.globalId}` — whichever is correct.

This is the same fix as TASK 03 (create redirect) but
affects the classroom list cards as well.

BUG 3 — Profile tab "something went wrong":
The profile page crashes immediately. Check
apps/web/app/profile/page.tsx for:
- API calls that fire before auth token is available
- Missing null checks on user data
- Unhandled promise rejections

Fix: wrap API calls in try/catch, add null checks on all
user fields before rendering, show a loading state while
fetching. Never let an API failure crash the whole page —
show an error state with a retry button instead.

BUG 4 — Bell icon has no UI behind it:
The bell icon in the nav/classroom header is a placeholder.
For now: remove the onClick handler so it does nothing,
or add a tooltip "Notifications coming soon" on hover.
Do not leave a broken click that does nothing silently.
Notifications UI is built properly in TASK 09.

Run: npm run test and next build
Commit: "fix: NaN members, undefined classroom link, profile crash, bell icon"

---

## TASK 08 — Home tab and Classes tab redesign [DONE: Home rewritten as an activity feed (greeting header, unread/classroom-count subtitle, verification nudge kept, feed sourced from the new GET /notifications read endpoints — built here since nothing existed yet, see TASK 09 note); "Suggested classrooms" skipped (no GET /classrooms/suggested endpoint, documented rather than faked) and new_message/new_member/vouch_request feed item types skipped (no backend event emits them yet — only verification.*/event.created are real). New /classes page: search-filtered classroom list + sticky "+ New Classroom" with an inline creation form (extracted the old /classroom/create page body into a shared components/ClassroomCreateForm.tsx so both routes use one implementation); teacher persona is redirected to the existing /teacher filing-cabinet view instead of a second grouped-list implementation. New /messages placeholder page. BottomNav's Classes tab now points at /classes (was a /classroom/create workaround). Backend: notification.controller.ts is this module's first-ever HTTP surface — GET /notifications, GET /notifications/unread-count, POST /notifications/mark-read — needed by both this task and TASK 09.]

The mockup defined a clear split between Home and Classes
that was not followed during the build. Fix this now.

Read the existing home and classes screens before changing:
- apps/web/app/(home)/page.tsx (or equivalent home route)
- apps/web/app/classes/page.tsx (or equivalent)
- apps/web/components/layout/AppShell.tsx (tab navigation)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOME TAB — Activity feed (what's coming TO the user)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Home is NOT a classroom list. It is a feed of activity
across all the user's classrooms.

Layout (top to bottom):

1. Header:
   - "Good morning, [first name]" (or afternoon/evening)
   - Small subtitle: "[N] classrooms · [N] unread"
   - Bell icon (links to notifications dropdown — TASK 09)

2. Verification nudge banner (if any classroom has
   pending verification status):
   Amber background, icon, text:
   "You have pending verifications in [N] classroom(s)"
   Link → /verify

3. Activity feed — chronological, newest first:
   Each feed item is a card showing:

   Type: new_message
   "[Name] posted in [Classroom name]"
   Preview: first 80 chars of the message
   Time: "2 minutes ago"
   Tap → opens that classroom

   Type: new_member
   "[Name] joined [Classroom name]"
   Time: "1 hour ago"
   Tap → opens that classroom's members tab

   Type: verification_approved
   "You are now verified in [Classroom name] ✓"
   Time: "Yesterday"
   Green accent

   Type: event_created
   "[Name] created an event in [Classroom name]"
   Event name + date
   Tap → opens that classroom's events

   Type: vouch_request
   "[Name] is asking for your vouch in [Classroom name]"
   "Vouch for them" button inline
   Tap button → calls vouch API immediately

4. If no activity yet (new user):
   Empty state:
   Icon: graduation cap (simple SVG)
   Heading: "Your feed is quiet for now"
   Sub: "Join a classroom to start seeing activity here"
   Button: "Find your batch" → /classes

5. "Suggested classrooms" section (below feed):
   Only shown if user has fewer than 3 classrooms.
   Heading: "You might know people in..."
   Show 2-3 classrooms based on institution matches
   from the user's profile.
   Each with member count and "Join" button.
   If no suggestions available: hide this section entirely.

API calls needed:
- GET /v1/notifications?limit=20&types=activity
  (or equivalent feed endpoint — check what exists)
- If no feed endpoint exists: use GET /v1/notifications
  and filter/display appropriately
- GET /v1/classrooms/suggested (if exists, otherwise skip
  the suggestions section and document as future work)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLASSES TAB — Classroom directory (where the user navigates TO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Classes is the full list of classrooms the user belongs to.
NOT the classroom creation form. NOT the home feed.

Layout:

1. Header:
   "My Classrooms" heading
   Search input: "Search your classrooms..." (filters the list)

2. Classroom list:
   Each classroom as a card (same ClassroomCard component):
   - Institution name (muted, small)
   - Classroom name (bold)
   - Batch year · member count
   - Last activity time ("Active 2h ago" or "Quiet")
   - Verification badge (Verified / Early member / Pending)
   - Unread count badge (red pill, top right of card)
   Sorted by: most recently active first
   Tap → opens /classroom/[globalId]

   Alumni mode: flat list sorted by last activity
   Teacher mode: grouped by institution (filing cabinet)
   The app should detect persona from auth state and
   render accordingly.

3. Empty state (no classrooms yet):
   "You haven't joined any classrooms yet."
   "Find your batch and reconnect with your people."
   Button: "Find your batch" → triggers the create/search flow

4. Sticky "New Classroom" button at the bottom of the list:
   Position: sticky bottom, full width minus padding
   Background: brand primary purple
   Text: "+ New Classroom"
   On click: expands an inline form ABOVE the button
   (pushes the list up, does not navigate away)

   Expanded state:
   - The classroom creation form appears inline
     (institution search, section, year, etc.)
   - A "-" or "✕ Cancel" button collapses it back
   - On successful creation: collapses form,
     adds new classroom to top of list,
     shows success toast: "Classroom created!"
   - On error: shows inline error, stays expanded

   The form is the same fields as the current
   /classroom/create page but rendered inline here.
   Reuse the same API call and validation logic.
   Do NOT navigate to a separate page.

API calls:
- GET /v1/classrooms/my (or equivalent — check what exists)
- POST /v1/classrooms (existing create endpoint)
- GET /v1/institutions/search?q= (for institution autocomplete)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NAV TAB LABELS AND ICONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Update apps/web/components/layout/AppShell.tsx tab bar:

Tab 1: Home
Icon: house (existing)
Route: / or /home

Tab 2: Classes
Icon: book or graduation cap (existing)
Route: /classes

Tab 3: Messages (placeholder for now)
Icon: chat bubble
Route: /messages
Page: simple placeholder "Direct messages coming soon"
Do NOT remove this tab — it anchors the nav visually

Tab 4: Profile
Icon: person (existing)
Route: /profile

Run: npm run test and next build
Commit: "feat: home activity feed, classes tab with inline creation,
correct tab structure matching original mockup"

---

## TASK 09 — Notifications dropdown [DONE: backend read endpoints (GET /notifications, /notifications/unread-count, POST /notifications/mark-read) were already built in TASK 08 since the home feed needed them first — confirmed here they return the right shape. Frontend: new components/NotificationBell.tsx (bell + dropdown, unread badge, mark-all-read, per-item mark-read-on-click, empty/loading states, navigates via data.classroom_id), wired into the home page in place of the static bell. Real-time: went straight to the documented 60s unread-count polling fallback rather than attempting Supabase Realtime — lib/supabase.ts's client is only ever used anonymously (document uploads), never authenticated as the signed-in user (this app uses its own custom JWT, not Supabase Auth sessions), so a Realtime subscription gated by the notifications_own RLS policy (auth.uid()-based) could not have matched any rows — this is the exact "JWT mismatch known issue" the task's own fallback text anticipates.]

The bell icon exists but has no UI behind it.
Build the notifications dropdown.

BACKEND:
Check what the GET /v1/notifications endpoint returns.
Read apps/backend/src/modules/notification/notification.service.ts
Confirm it returns: id, type, title, body, is_read, created_at, data

If the endpoint doesn't exist or returns wrong shape:
fix it to return paginated notifications for the current user
sorted by created_at DESC, limit 20 by default.

Also add: POST /v1/notifications/mark-read
Body: { notificationIds: string[] } or { all: true }
Marks notifications as read.

FRONTEND:
In apps/web/components/layout/AppShell.tsx

1. Bell icon behavior:
   On click: toggle a dropdown panel below the bell
   Close on: click outside, press Escape, click any notification
   Show unread count badge on bell (red pill, number)
   If 0 unread: no badge shown
   If 9+ unread: show "9+"

2. Dropdown panel:
   Position: absolute, top-right, below the bell icon
   Width: 360px
   Max-height: 480px with overflow-y: auto
   Background: white
   Border: 1px solid var(--color-border)
   Border-radius: 12px
   Box-shadow: 0 8px 32px rgba(0,0,0,0.12)
   z-index: 100 (above other content)

   Header row:
   "Notifications" (bold, 14px)
   "Mark all read" link (right aligned, muted, 12px)
   On click: call mark-read API with { all: true }

   Notification items:
   Each item:
   - Left: colored dot (unread = brand primary, read = transparent)
   - Title (bold if unread, normal if read, 13px)
   - Body text (muted, 12px, max 2 lines, truncated)
   - Time (right aligned, muted, 11px) "2m" / "1h" / "Yesterday"
   - Full row is clickable
   - On click: mark as read + navigate based on type:
     new_message → /classroom/[classroomId]
     new_member → /classroom/[classroomId]
     verification_approved → /classroom/[classroomId]
     vouch_request → /classroom/[classroomId]
     default → /notifications (if page exists, else no-op)
   - Hover: light purple background

   Empty state (no notifications):
   Bell illustration (simple SVG, muted)
   "You're all caught up"
   Muted, 13px, centered

   Loading state:
   3 skeleton rows while fetching

3. Fetch on open:
   GET /v1/notifications?limit=20
   Only fetch when dropdown opens (not on page load)
   Show loading skeleton while fetching
   Cache for 30 seconds (don't refetch if reopened quickly)

4. Real-time updates (if Supabase Realtime works):
   Subscribe to notifications table for current user
   On new notification: increment unread badge count
   Show a subtle "New notification" banner at top of
   dropdown if it's open when a new one arrives
   If Realtime is not working (JWT mismatch known issue):
   Poll GET /v1/notifications/unread-count every 60 seconds
   just for the badge count — not the full list

Run: npm run test and next build
Commit: "feat: notifications dropdown with mark-read and real-time badge"

---

## TASK 10 — UI polish pass across all pages [PENDING]

The built UI looks basic compared to the mockup (alumini-demo.html).
The mockup had precise card groupings, pill chips, colored avatars,
inline tags, proper badges, and consistent spacing.
This task ports that design quality to every page.

Read alumini-demo.html in full before starting.
Read apps/web/styles/globals.css before starting.
Read every page file before changing it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART A — Design tokens and base components
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Update apps/web/styles/globals.css
   Add/confirm these utility classes exist:

   Card styles:
   .card {
     background: white;
     border-radius: 12px;
     border: 1px solid var(--color-border);
     padding: 14px;
     transition: border-color 0.15s;
   }
   .card:hover { border-color: #ccc; }
   .card-sm { padding: 10px 12px; border-radius: 10px; }
   .card-lg { padding: 18px 20px; border-radius: 14px; }

   Badge/pill styles:
   .badge {
     display: inline-flex;
     align-items: center;
     gap: 4px;
     padding: 3px 10px;
     border-radius: 99px;
     font-size: 11px;
     font-weight: 600;
     white-space: nowrap;
   }
   .badge-verified  { background: #dcfce7; color: #166534; }
   .badge-pending   { background: #fef9c3; color: #854d0e; }
   .badge-early     { background: #dbeafe; color: #1e40af; }
   .badge-rejected  { background: #fee2e2; color: #991b1b; }
   .badge-teacher   { background: #ede9fe; color: #4c1d95; }
   .badge-admin     { background: #f0fdf4; color: #166534; }
   .badge-neutral   { background: #f5f5f5; color: #666;
                      border: 1px solid #e5e5e5; }

   Filter chip styles:
   .chip {
     padding: 5px 14px;
     border-radius: 99px;
     border: 1px solid var(--color-border);
     background: white;
     font-size: 12px;
     font-weight: 500;
     cursor: pointer;
     transition: all 0.15s;
   }
   .chip-active {
     background: var(--color-primary);
     color: white;
     border-color: var(--color-primary);
   }

   Avatar styles:
   .avatar {
     border-radius: 50%;
     display: flex;
     align-items: center;
     justify-content: center;
     font-weight: 600;
     flex-shrink: 0;
   }
   Sizes: .avatar-sm (24px/10px font)
          .avatar-md (32px/12px font)
          .avatar-lg (44px/16px font)
          .avatar-xl (56px/20px font)
   Colors cycle through 6 brand-adjacent colors based on
   first letter of name (deterministic, not random):
   Purple, green, amber, blue, rose, teal

   Tag styles (inline info like "PM · Razorpay · Mumbai"):
   .tag {
     font-size: 11px;
     color: var(--color-text-muted);
     display: inline-flex;
     align-items: center;
     gap: 4px;
   }
   .tag-dot::before { content: '·'; margin: 0 2px; }

2. Update apps/web/components/ui/Badge.tsx
   Use the CSS classes above. Support icon prop (optional SVG).
   Support size prop: sm (default) and md.

3. Update apps/web/components/ClassroomCard.tsx
   Match the mockup card style exactly:
   - Institution name (muted, 11px, uppercase letter-spacing)
   - Classroom name (bold, 14px)
   - Row: batch year · member count (use ?? 0) · last active
   - Badge row: verification status badge
   - Unread count badge (red pill, top-right corner, absolute)
   - Hover: border lightens, subtle shadow
   - Active/pressed: scale(0.99)
   - Chevron right (›) right edge

4. Create apps/web/components/ui/FilterChips.tsx
   Props: options: {label, value}[], value, onChange
   Renders horizontal scrollable row of chips.
   First chip is always "All" (value: null).
   Used on: classroom list, search results, member list.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART B — Page by page polish
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EVERY page listed below, apply these rules:
- All list items inside a .card or .card-sm container
- Section headings: 10px, uppercase, letter-spacing 0.4px,
  color var(--color-text-muted), margin-bottom 8px
- Consistent 14px padding on all sides of content areas
- Buttons: min-height 44px (touch target), border-radius 10px
- Input fields: border-radius 10px, height 48px, font-size 16px
- Empty states: centered, muted icon, heading, sub, CTA button
- Loading states: skeleton cards matching the content shape
- No raw error strings shown to user ever

Pages to polish:

1. apps/web/app/(home)/page.tsx — activity feed
   Each feed item: .card-sm with left colored dot,
   title, preview text, timestamp right-aligned
   Section dividers between date groups (Today / Yesterday / Earlier)

2. apps/web/app/classes/page.tsx — classroom list
   ClassroomCard components in a gap-3 flex column
   FilterChips row at top (filter by institution)
   Sticky "+ New Classroom" button at bottom

3. apps/web/app/classroom/[globalId]/page.tsx — classroom view
   Header: dark brand gradient (match mockup)
   Stats row: members · teachers · verified (with numbers)
   Tab bar: Students | Staff Room (locked if student) | Members
   Messages: bubble style (match mockup exactly)
     - Other: white bubble, left aligned, name above
     - Own: brand primary bubble, right aligned, no name
     - System messages: centered pill (gray background)
   Member list: .card-sm per member, avatar + name + badge + dot

4. apps/web/app/verify/page.tsx — verification flow
   Each verification method: .card with number circle,
   method name (bold), description (muted), status icon
   Completed method: green border, checkmark
   Active method: blue border, expanded with action button
   Locked method: gray, opacity 0.6

5. apps/web/app/profile/page.tsx — user profile
   Stats row: classrooms · connections · profile % (cards)
   Classroom list: ClassroomCard components
   Section headings with proper spacing

6. apps/web/app/persona/page.tsx — persona switcher
   Two large cards side by side (Alumni | Teacher)
   Active card: dark background, white text, "Active" pill
   Inactive: white, border, "Switch" pill
   Match mockup exactly

7. apps/web/app/teacher/page.tsx — teacher filing cabinet
   Accordion groups by school (dark header, expandable)
   Each class row: dot (green=active, gray=alumni) +
   class name + student count + badge
   "Show all N classes" expand link at bottom of each group

8. apps/web/app/admin/page.tsx — admin dashboard
   Stats cards row at top
   Pending verifications: .card per item, document preview,
   Approve/Reject buttons inline

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART C — Global consistency
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Page background: var(--color-bg) (#F0ECFF or equivalent)
   Not white — the light purple tint from the mockup
   Content cards sit on this background in white

2. Font sizes strictly:
   Page heading: 18px bold
   Section heading: 10px uppercase muted
   Card title: 13-14px bold
   Card subtitle: 11-12px muted
   Body: 14px
   Timestamp/meta: 11px muted

3. Touch targets: every clickable element min 44px tall
   (already in globals but audit every button and link)

4. Transitions: all interactive elements have
   transition: all 0.15s ease on hover/active

5. No hardcoded colors anywhere — all via CSS variables

Run: next build — must pass with 0 errors
Run: npx tsc --noEmit in apps/web — 0 type errors
Commit: "feat: UI polish pass — cards, badges, chips, spacing across all pages"

---

## TASK 11 — School admin dashboard [PENDING]

School admins need a dedicated dashboard to manage their
institution's classrooms, verify members, and generate
batch codes. This is separate from the platform admin
(which is you, the app owner).

A "school admin" is a user with role='admin' in at least
one classroom at an institution. They see admin features
only for their institution — not others.

BACKEND:

Confirm these endpoints exist in admin.controller.ts.
If missing, build them:

GET /admin/:institutionId/overview
Returns:
{
  institution: { name, slug, type, city },
  stats: {
    totalClassrooms: number,
    totalMembers: number,
    verifiedMembers: number,
    pendingVerifications: number,
    activeClassrooms: number,
  },
  recentActivity: [...] -- last 10 events across classrooms
}

GET /admin/:institutionId/classrooms
Returns all classrooms for this institution with:
- globalId, name, batchYear, section
- memberCount, verifiedCount, pendingCount
- createdAt, lastActivityAt

GET /admin/:institutionId/verifications/pending
Returns pending verification requests across all classrooms:
- userId, userName, avatarUrl
- classroomName, classroomGlobalId
- method (document/peer_vouch/etc)
- documentUrl (if document method)
- submittedAt

POST /admin/:institutionId/verifications/:verificationId/approve
Approves a verification request.
Sets membership verification_status = 'verified'.

POST /admin/:institutionId/verifications/:verificationId/reject
Body: { reason: string }
Sets verification_status = 'rejected'.
Notifies the user.

POST /codes/batch
Generates batch verification codes for a classroom.
Body: { classroomId, count (max 100), expiresInDays }
Returns: { codes: string[] }
Each code is single-use, linked to the classroom.

GET /admin/:institutionId/analytics
Returns:
{
  memberGrowth: [{ month, count }] -- last 6 months
  verificationMethods: [{ method, count }]
  topClassrooms: [{ name, memberCount }]
}

FRONTEND:

Build apps/web/app/admin/page.tsx properly:

The page is only accessible to users who are admin in
at least one classroom. Check this on mount — redirect
to / if not an admin anywhere.

Layout — tabs:

TAB 1: Overview
- Institution name + type as page heading
- Stats row: 5 stat cards (total classrooms, members,
  verified, pending verifications, active classrooms)
- Recent activity feed (last 10 events)
- Quick actions: "Review verifications" → tab 2
                 "Generate batch codes" → tab 4

TAB 2: Verifications
Heading: "Pending verifications ([count])"
Each pending verification as a card:
  - User avatar + name
  - Classroom name
  - Method badge (Document / Peer vouch / etc)
  - Submitted time
  - If document method: "View document" link (opens in new tab)
  - Approve button (green) + Reject button (red)
  - On approve: optimistic UI — card fades out, count decrements
  - On reject: prompt for reason, then fade out
Empty state: "No pending verifications. You're all caught up."

TAB 3: Classrooms
List of all classrooms at this institution.
Each as a card:
  - Classroom name + global ID (monospace, small)
  - Members: N verified / N pending / N total
  - Last active: "2 hours ago"
  - "View classroom" link → /classroom/[globalId]
Filter chips: All / Active / Alumni (by batch year)

TAB 4: Batch Codes
Generate verification codes for a classroom.
Form:
  - Select classroom (dropdown of their classrooms)
  - Number of codes: 10 / 25 / 50 / 100 (radio)
  - Expires in: 7 days / 30 days / 90 days (radio)
  - Generate button
On success:
  - Show codes in a monospace grid
  - "Copy all" button → copies all codes as newline-separated text
  - "Download CSV" button → downloads codes.csv
  - Warning: "Share these codes carefully. Each can only be used once."
Existing codes list below the form (unexpired, with used/total count)

TAB 5: Analytics (simple, no charts needed yet)
Member growth: simple table last 6 months
  Month | New members | Cumulative
Verification breakdown: table
  Method | Count | % of total
Top classrooms by member count: ordered list

Style: use the polished card/badge system from TASK 10.
All admin actions must have loading states and error handling.

Run: npm run test — all tests pass
Run: next build — passes
Commit: "feat: school admin dashboard — overview, verifications,
classrooms, batch codes, analytics"

---

## COMPLETION SUMMARY

(Claude Code fills this in when all tasks are [DONE])

Date completed:
Tasks completed:
Tests passing:
Build status:
Migrations to run manually in Supabase IN ORDER:
  - 011_pending_auto_status.sql (TASK 04)
  - 012_institution_requests.sql (TASK 05)
  - 013_seed_institutions.sql (TASK 05)
Notes:

---

## RESUMPTION GUIDE

Paste this to resume after any interruption:

"Read TASKS_02.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
