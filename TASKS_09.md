# AlumTribe — Task Batch 09

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_09.md along with the code changes
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

## TASK 01 — Feature: new user landing screen (all three personas) [DONE]

Deferred — marking as done for now, will revisit later.

New users who have not joined any classrooms get a confusing
empty state. Replace with a purpose-built landing screen
that gets them to their first classroom fast.

The screen adapts based on the user's active_persona:
  student → "Find your batch"
  teacher → "Find your classes"
  admin   → "Set up your institution"

Read apps/web/app/(home)/page.tsx
Read apps/web/app/classes/page.tsx

Detect new user: memberships count = 0 on first load.
Show the new user landing screen instead of the empty state.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STUDENT LANDING (active_persona = 'student' or default)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Header: "Welcome, [firstName]" + subtitle "Let's find your batch"

Hero search (auto-focused on mount):
  Large input, placeholder: "Search your school or college..."
  Calls GET /v1/institutions/search?q= (300ms debounce, min 2 chars)
  On institution selected → GET /v1/classrooms/search?q=[slug]
  Each result card:
    Institution icon (36px) + classroom name + batch year + member count
    "Join" button (ghost, brand primary border)
  No results: "No classrooms found — + Create this classroom"

Two quick action cards (grid 2 cols):
  Card 1: school icon + "Join a batch" + "Find and join your classrooms"
  Card 2: plus icon + "Create a classroom" → /classroom/create

How it works (3 steps):
  Numbered circles: Find school → Join batch → Reconnect

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEACHER LANDING (active_persona = 'teacher')
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Header: "Welcome, [firstName]" + "Find your classes or create new ones"

Same search — results show "Join as teacher" button instead of "Join"

Two quick action cards:
  Card 1: users icon + "Join a class"
  Card 2: plus icon + "Create a classroom" → /classroom/create

How it works:
  Find school → Join or create classroom → Connect with students

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADMIN LANDING (active_persona = 'admin' or is_platform_admin)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Header: "Welcome, [firstName]" + "Set up your institution on AlumTribe"

Search placeholder: "Search for your institution..."
  If found: "Claim admin access" button
  If not found: "Request your institution" link

Amber info card:
  "Your institution needs approval before you can manage classrooms."

Two quick action cards:
  Card 1: building icon + "Find institution"
  Card 2: send icon + "Request institution" → inline request form

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHARED RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Page background: var(--color-bg)
All cards: white, border-radius 12px, 1px border
Search: 2px brand primary border when focused
Once user joins first classroom: landing disappears,
normal home feed takes over without reload

Run: npm run test and next build
Commit: "feat: new user landing screen — student, teacher, admin variants"

---

## TASK 02 — Feature: home feed for returning users [PENDING]

Polish the activity feed for users who have joined classrooms.

Read apps/web/app/(home)/page.tsx

Feed items (newest first):

new_message:
  Avatar + "[Name] posted in [Classroom]"
  Preview: first 80 chars (muted)
  Time: relative — tap → /classroom/[globalId]

new_member:
  Avatar + "[Name] joined [Classroom]"
  Tap → /classroom/[globalId] members tab

verification_approved:
  Green check + "You are now verified in [Classroom]"
  Green left border accent

vouch_request:
  Avatar + "[Name] is asking for your vouch in [Classroom]"
  Inline "Vouch" button (optimistic)

Date group headers: "Today" / "Yesterday" / "Earlier this week"

Verification nudge banner (if any classroom has pending status):
  Amber bg, amber border-left 3px
  "You have pending verifications in [N] classroom(s)"
  "[Complete verification →]" link + dismiss X button
  localStorage key: dismissed_verify_nudge

Suggested classrooms (if fewer than 3 classrooms):
  Heading: "SUGGESTED FOR YOU"
  2-3 cards with Join button

Empty feed (has classrooms, no activity yet):
  Show classroom cards
  Below: "No recent activity yet. Start a conversation."

Run: next build
Commit: "feat: home feed — activity items, date groups,
verification nudge, suggested classrooms"

---

## TASK 03 — Fix: classroom shows join prompt for existing members [PENDING]

Navigating to a classroom from notification or event shows
"Join classroom" even if the user is already a member.
Clicking join returns 409 confirming they ARE a member.

Read apps/web/app/classroom/[globalId]/page.tsx

Fix 1 — Loading state before membership check:
  Show skeleton while membership data loads.
  Never show "Join" during loading.
  Only show "Join" after confirmed NOT a member.

Fix 2 — Membership check order:
  Fetch membership status FIRST on page load.
  GET /v1/classroom/[globalId] should include user's membership.
  Until resolved: loading state only.

Fix 3 — 409 on join treated as success:
  If POST /memberships/join returns 409:
  Do not show error.
  Treat as success — refresh membership data, show classroom.
  Log: warn '[MEMBERSHIP:join] already member — treating as success'

Fix 4 — Deep links from notifications and events:
  Same fix applies — load membership first before rendering.

Run: next build
Commit: "fix: classroom join prompt not shown to existing members"

---

## TASK 04 — Fix: conversations tab — initiate new DM [PENDING]

Messages tab has no way to start a new conversation.

Read apps/web/app/messages/page.tsx

Add compose button to conversations header:
  Right side: ti-edit icon button (24px)

On click — "New conversation" flow:
  Search input: "Search your classmates..."
  Calls GET /v1/search/students?q=[query]
  Results: verified members from shared classrooms
  Each: avatar + name + shared classroom name (muted)
  Tap person → opens DM thread

No results state:
  "You can only message verified members of your classrooms."

Also add "Message" button to member cards in classroom members tab:
  In apps/web/app/classroom/[globalId]/page.tsx
  Each member card (except current user):
  Small ghost "Message" button
  On click: navigate to /messages?userId=[memberId]

Run: next build
Commit: "feat: new conversation button, message button on member cards"

---

## TASK 05 — Fix: edit profile button — pencil icon [PENDING]

The "Edit profile" button shows as text. Replace with a
pencil icon matching the mockup.

Read apps/web/app/profile/page.tsx
Find the "Edit profile" button in the profile header.

Replace text button with icon button:
  ti-pencil icon (20px, var(--color-text-muted))
  No text label
  Position: top right of the profile header card
  Style: ghost, no border, just the icon
  On hover: icon color darkens to var(--color-text-primary)
  On click: existing edit profile behaviour unchanged

Run: next build
Commit: "fix: edit profile — pencil icon button"

---

## TASK 06 — Fix: MFA challenge endpoint missing or CORS [PENDING]

TOTP verification fails with CORS error:
POST /v1/auth/mfa/challenge → no Access-Control-Allow-Origin header

This is almost always caused by the endpoint not existing —
NestJS returns nothing on unmatched routes which has no
CORS headers, browser interprets it as a CORS failure.

Read apps/backend/src/modules/auth/auth.controller.ts
Check if POST /auth/mfa/challenge exists.

If missing — add it:
  This endpoint is used by the change-password modal
  to verify MFA before allowing password change.
  It should accept the current MFA code and return
  a short-lived challenge token if valid.

  @Post('mfa/challenge')
  @UseGuards(JwtAuthGuard)
  async mfaChallenge(@Request() req, @Body() dto: MfaChallengeDto)

  Body: { code: string, method: 'email' | 'totp' }
  Logic:
    If method = 'totp': verify TOTP code against stored secret
    If method = 'email': verify email OTP code
    On success: return { challengeToken: jwt (5 min expiry) }
    On failure: throw UnauthorizedException('Incorrect code')

  The challengeToken is then used by POST /auth/change-password
  to confirm MFA was completed before allowing the change.

If endpoint EXISTS but CORS fails:
  Read apps/backend/src/main.ts
  Confirm CORS config includes all methods and origins.
  Confirm OPTIONS is in allowed methods.

Run: npm run test — all tests pass
Commit: "fix: add mfa/challenge endpoint for TOTP verification"

---

## TASK 07 — Fix: unverified members can send messages [PENDING]

Unverified students can post messages in classroom and
student alley. Only verified members should be able to post.
Pending and pending_auto members should be read-only.

Read apps/backend/src/modules/corridor/corridor.service.ts
Find the sendMessage() method.

The guard before inserting must check:
  verification_status IN ('verified', 'pending_auto') for posting
  Wait — pending_auto should also be read-only until verified.
  Only 'verified' members can post.

Fix the check:
  If membership.verification_status !== 'verified':
    throw ForbiddenException('You must be verified to post messages')

Read apps/web/app/classroom/[globalId]/page.tsx
The message input must also be hidden for unverified members:
  If verification_status !== 'verified':
    Hide the message input entirely
    Show amber banner: "Verify your membership to start posting"
    "[Verify now →]" link → /verify?classroomId=[globalId]

Run: npm run test and next build
Commit: "fix: unverified members cannot post messages"

---

## TASK 08 — Fix: new joiner cannot see classroom events [DONE: listEvents() no longer hard-requires verified status — future events visible to any member, past events stay verified-only and only if created after joined_at; matching RLS update (migration 026); also fixes globalId vs UUID resolution in membership/corridor/events services (was raising "invalid input syntax for type uuid")]

After requesting to join a classroom, the user cannot
see events of that class.

Read apps/backend/src/modules/events/events.service.ts
Find getEvents() method.

Current likely behaviour: only verified members see events.
Expected behaviour per product rules:
  Future events (start_date >= now()) visible to ALL members
  regardless of verification status — even pending members.
  Past events only visible to verified members and
  only if created after their join date.

Fix the events query:
  For pending/pending_auto members:
    Return only future events (start_date >= now())
  For verified members:
    Return future events + past events created after joined_at

Also check the RLS policy on events table if it exists.

Run: npm run test
Commit: "fix: pending members can see future events"

---

## TASK 09 — Fix: verify link fails for new joiners [DONE: globalId vs UUID was already fixed by TASK 08's membership.service.ts resolution + the frontend link fix; found and fixed the actual remaining gap — a plain NotFoundException (no errorCode) fell through to a generic "Something went wrong" instead of the specific "You are not a member of this classroom" message, plus added console.error logging on load failure]

Clicking the verify link as a new unverified member fails
instead of showing the verification methods screen.

Read apps/web/app/verify/page.tsx

The verify page must:
1. Load the user's current verification status for the classroom
   GET /v1/verify/status/:membershipId
   or GET /v1/membership/[classroomId] to get membershipId

2. Show all 5 verification methods as cards (match mockup):
   Each method as a white card with number circle:
   1. Email domain match (auto, show status)
   2. Peer vouching (show vouch progress)
   3. Document upload (show upload button)
   4. LinkedIn import (show connect button)
   5. Institution code (show code input)

3. If classroomId is in URL params (?classroomId=):
   Pre-load that classroom's verification context
   Show which methods are available for that institution

Currently failing likely because:
  - membershipId not found (globalId vs UUID issue)
  - API call failing silently
  - Page crashing on missing data

Add error handling:
  If membership not found: "You are not a member of this classroom"
  If API fails: show retry button, log full error

Also fix the globalId vs UUID issue:
  The verify page may be passing globalId where UUID expected
  Same fix as UPDATE 08 in fileUpdates.md — resolve first

Run: next build
Commit: "fix: verify page loads correctly for new unverified members"

---

## TASK 10 — Fix: admin cannot verify new unverified members [DONE: new classroom-scoped GET /verify/pending/:classroomId endpoint (assertClassroomAdmin — classroom role=admin/is_creator or school admin, not just institution admin); members tab shows MFA-guarded Verify/Reject buttons on pending document verifications with optimistic badge update; admin notification on document submission already existed (NotificationService.handleDocumentSubmitted)]

Classroom admins and creators have no UI to approve or
reject verification requests from new members.

Read apps/web/app/classroom/[globalId]/page.tsx members tab

For users with role='admin' or is_creator=true:
Show a "Pending" filter chip in the members tab.
When viewing pending members, each pending member row shows:
  "Verify" button (green, small)
  "Reject" button (red, small, ghost)

On "Verify":
  POST /v1/admin/[institutionId]/verifications/[verificationId]/approve
  OR POST /v1/verify/document/:verificationId/approve
  (check which endpoint exists for admin approval)
  Optimistic: change member badge from "Pending" to "Verified"

On "Reject":
  Show inline reason input
  POST reject endpoint with reason
  Optimistic: remove member from pending list

Also check: does the verification request appear in the
admin dashboard (apps/web/app/admin/page.tsx)?
If yes — link from classroom members tab to admin dashboard.

Also notify the admin when a new member joins and needs verification:
  Check if notification is sent in membership.service.ts joinClassroom()
  If not — add: notify all admins/creators of that classroom

Run: next build
Commit: "fix: admin can verify/reject new members from classroom members tab"

---

## TASK 11 — Fix: clicking event shows join prompt instead of event [PENDING]

Clicking an event (from classroom tab or notification)
redirects to the classroom and shows "Join this classroom"
even if the user is already a member.

This was reported earlier and TASK 03 addresses part of it
(membership check before showing join prompt) but the
event deep link specifically is still broken.

Read apps/web/app/classroom/[globalId]/page.tsx
Read how event links are constructed in notifications
and in the classroom events list.

Fix 1 — Event deep link routing:
  /classroom/[globalId] should check membership first
  If member: show classroom with events tab active
  If not member: show join prompt
  This is TASK 03 — confirm it's working first

Fix 2 — Direct event link /classroom/[globalId]/events/[eventId]:
  Create this route if it doesn't exist
  Load the specific event details directly
  Check membership — if member show event, if not show join prompt

Fix 3 — Notification click handler:
  In notification items, when type = 'event_created':
  data.classroom_id contains the classroom globalId
  data.event_id contains the event ID
  Navigate to: /classroom/[globalId]?tab=events&eventId=[eventId]
  The classroom page reads these params and opens the right tab

Fix 4 — globalId vs UUID in event queries:
  Same issue as UPDATE 08 — if event queries use globalId
  where UUID expected, resolve first before querying

Run: next build
Commit: "fix: event deep links route correctly, membership
checked before showing join prompt"

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

"Read TASKS_09.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
