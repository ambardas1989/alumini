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

## TASK 01 — Feature: new user landing screen (all three personas) [DONE: added NewUserLanding.tsx (student/teacher/admin variants) shown on the home page when a user has zero memberships and zero feed activity — hero search (searchClassrooms for student/teacher, searchInstitutions + claim/request flow for admin), quick action cards, "how it works" steps; disappears automatically once the user joins/claims via the existing load() state without a reload]

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
