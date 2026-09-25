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

## TASK 08 — Fix: new joiner cannot see classroom events [DONE]

Pending members can now see future events regardless of verification status.

---

## TASK 09 — Fix: verify link fails for new joiners [DONE]

Verify page now loads correctly with all 5 verification methods shown.

---

## TASK 10 — Fix: admin cannot verify new unverified members [DONE]

Admin verify/reject buttons added to classroom members tab.

---

## TASK 11 — Fix: clicking event shows join prompt instead of event [DONE]

Event deep links now check membership before showing join prompt.

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




## TASK 12 — Fix: pending filter counts and member verification UI [PENDING]

Two issues in the classroom members panel:

FIX A — Pending filter shows 0 despite pending_auto members:
Read apps/web/app/classroom/[globalId]/page.tsx
Find where member filter counts are calculated.

The "Pending" filter must count:
  verification_status = 'pending' OR verification_status = 'pending_auto'
Not just 'pending'.

Also the Pending tab must show both pending and pending_auto members.

FIX B — No verify button for admins/creators:
For users with role='admin' or is_creator=true:
Each pending/pending_auto member row must show:
  "Verify" button (green, small, ghost)
  "Reject" button (red, small, ghost)

On "Verify":
  PATCH /v1/membership/[membershipId]/verify
  or POST /v1/admin/[institutionId]/verifications/[id]/approve
  Check which endpoint exists — use that one
  If neither exists: call PATCH with body { verification_status: 'verified', verification_method: 'admin' }
  Optimistic: change badge from pending to verified immediately

On "Reject":
  Show small inline reason input below the row
  Submit → mark as rejected
  Optimistic: update badge to rejected

Run: next build
Commit: "fix: pending filter includes pending_auto, admin verify buttons on members"

---

## TASK 13 — Fix: DM open to all users, no restrictions [PENDING]

DMs should be completely open — any user can message
any other user on the platform. No shared classroom check,
no verification check.

Read apps/backend/src/modules/dm/dm.service.ts
Find sendMessage() and getMessages().

Remove ALL restrictions:
  Remove shared classroom check entirely
  Remove verification_status check entirely
  Only validation needed:
    sender_id != recipient_id (no self-messaging)
    content not empty, max 2000 chars
    recipient user must exist in profiles table

Read apps/web/app/messages/page.tsx
Read apps/web/app/classroom/[globalId]/page.tsx members tab

Remove any frontend checks that block DM based on
verification status. "Message" button shows for ALL
members including unverified and pending.

The ONLY place verification matters:
  Posting in classroom channels (corridor) — verified only
  DMs — completely unrestricted

Run: npm run test
Commit: "fix: DM fully open — no shared classroom or verification requirement"

---

## TASK 14 — Fix: theme toggle moves to profile, classroom card updates [PENDING]

THREE UI fixes from home screen observations.

FIX A — Move theme toggle to profile page:
Read apps/web/components/layout/AppShell.tsx
Remove the theme toggle (sun/moon icon) from the top nav header.

Read apps/web/app/profile/page.tsx
Add theme toggle in the account section:
  Row: "Appearance"
  Left: sun/moon icon
  Right: toggle switch (light/dark)
  Same logic: update data-theme on document.documentElement
  and save to localStorage

FIX B — Remove "members" text from classroom card:
Read apps/web/components/ClassroomCard.tsx
Find where member count is displayed.
Change from: "👥 2 members"
To: "👥 2" — icon + number only, no text label

FIX C — Add upcoming events count to classroom card:
Add events count stat next to member count:
  📅 [upcomingEventsCount]
  Show only if upcomingEventsCount > 0
  Hide entirely if 0 (don't show 📅 0)

Events count is role-aware:
  Student → classroom + student_alley channel events only
  Teacher → classroom + staff_room channel events only
  Admin → classroom + staff_room channel events only
  Nobody sees all three channels' events — student_alley
  is always private from teachers and admins

Same rule applies inside the classroom events tab:
  Student sees: classroom events + student_alley events
  Teacher sees: classroom events + staff_room events
  Admin sees: classroom events + staff_room events
  No role sees student_alley AND staff_room together

Fetch alongside classroom list or via:
  GET /v1/events/[classroomId]?upcoming=true

Run: next build
Commit: "fix: theme toggle to profile, classroom card — icon only count, events count"

---

## TASK 15 — Fix: classroom header stats and layout [PENDING]

Read apps/web/app/classroom/[globalId]/page.tsx

FIX A — Batch year display:
Remove "Batch of 2006" text.
Replace with: 📅 2006 (calendar icon + year only)
No "Batch of" prefix, no "(20 years ago)" suffix.

FIX B — Stats row cleanup:
Current: "👥 2 · ✓ 1 · 2006 (20 years ago)"
Replace with:
  👥 [memberCount]
  ✓ [verifiedCount]
  📅 [batchYear]
  ⏳ [pendingCount]  — only show if pendingCount > 0
                       counts pending + pending_auto members
  📍 [city]          — only show if city/city_code available
                       from institution or classroom

All stats: white 60% opacity, 11px, dot separator between each
Remove: "(20 years ago)" — completely, never show this

FIX C — Cover photo as full banner (Facebook style):
The classroom header background should be a full-width
cover photo when cover_url is set.
Current: dark gradient only
With cover: full width image as background with dark overlay
  background-image: url(cover_url)
  background-size: cover
  background-position: center
  Dark overlay: linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.7))
  All text remains white and readable over the overlay

Cover photo upload: open to ALL verified members + creator + admin
  NOT just admin as currently implemented
  Show camera icon overlay (bottom right of header)
  Visible to: role='admin', is_creator=true, verification_status='verified'
  Hidden from: pending, pending_auto, rejected members

Run: next build
Commit: "fix: classroom header — clean stats, full banner cover photo,
verified members can upload cover"

---

## TASK 16 — Feature: events as interactive tiles with RSVP [PENDING]

Events in the classroom feed are static cards.
They need to be clickable with full RSVP functionality.

Read apps/web/app/classroom/[globalId]/page.tsx
Read apps/backend/src/modules/events/events.controller.ts

BACKEND:

Confirm these endpoints exist — add if missing:

GET /events/:classroomId/:eventId
Returns full event details:
{
  id, title, description, startDate, endDate,
  location, channel, createdBy,
  rsvps: {
    going: number,
    notGoing: number,
    maybe: number,
    myRsvp: 'going' | 'not_going' | 'maybe' | null
  }
}

POST /events/:classroomId/:eventId/rsvp
Body: { status: 'going' | 'not_going' | 'maybe' }
Creates or updates user's RSVP for this event.
Returns: updated rsvp counts + user's new status.

DELETE /events/:classroomId/:eventId/rsvp
Removes user's RSVP (undecided).

FRONTEND:

Event tiles in classroom feed:
Event tile layout (compact, 3 lines):

  Line 1: Event title (bold 13px, full width)
           RSVP status icon right-aligned:
             ✓ green  = going
             ?  amber = maybe
             ✗ red    = not going
             + muted  = not responded (tappable)

  Line 2: 🕐 [date + time] · 👥 [N going] (muted 11px)
           e.g. "Oct 8, 3:00 AM · 👥 3 going"
           Show "👥 [N] going" only if N > 0
           If 0 going: just show the time, no count

  Line 3: 📍 [full address] (muted 11px)
           Single line, overflow: hidden, text-overflow: ellipsis
           white-space: nowrap
           Shows as much as fits in one line, cuts off with ...
           e.g. "Roastery Cafe, 12 MG Road, Kolk..."

  Full card tappable → opens event detail
  White card, border-radius 10px, 1px border
  Padding: 10px 12px
  Gap between lines: 3px

Collapsing if more than 2 upcoming events:
  Show first 2 events
  If more: "Show [N] more events ↓" link below
  On click: expand to show all
  On collapse: "Show less ↑"

Event detail view (opens as overlay/bottom sheet or new page):
  Event title (bold, 20px)
  Date + time (with calendar icon)
  Location (with map pin icon, tappable → opens maps)
  Description (if any)
  Created by: avatar + name (muted, small)

  RSVP section:
    Three buttons in a row:
      [✓ Going]  [? Maybe]  [✗ Can't go]
      Active button: filled, brand primary or status color
      Inactive: ghost border
    On click: POST /events/.../rsvp with selected status
    Optimistic update — button highlights immediately

  RSVP counts below buttons:
    "N going · N maybe · N can't go"
    Muted, 12px

  If user has RSVP'd: show "Change my response" link
  that re-enables the three buttons

  Close button (X top right) to dismiss

Run: npm run test and next build
Commit: "feat: events as interactive tiles — clickable, RSVP,
collapse if more than 2, event detail with RSVP change"

---

## TASK 17 — Fix: classroom details panel [PENDING]

The classroom details panel (opened via + button) needs fixes.

Read apps/web/app/classroom/[globalId]/page.tsx
Find the details panel/drawer component.

FIX A — Remove classroom ID:
Remove the global ID (IN-KOL-KVFORTW-10C-2006) display.
It's redundant — the share link does the same job.
Keep only: "Share classroom link" which contains the ID.

FIX B — Add city/town:
Below the classroom name and institution name:
Show city if available from institution.city_code or classroom.city
e.g. "KV Fort William · Kolkata"
If no city available: just institution name, no city.

FIX C — Fix upcoming events (globalId vs UUID bug):
Events showing "No upcoming events" because the events
fetch passes globalId where UUID is expected.

In the events fetch inside the details panel:
First resolve globalId to UUID:
  GET /v1/classroom/[globalId] already returns the classroom
  with its UUID id field — use that for the events fetch
  NOT the globalId string directly

Also apply the same tile structure as TASK 16:
  3-line compact tiles, clickable, collapse if > 2
  Same RSVP icon, time, address format

FIX D — Ensure "Create event" respects channel:
When creating an event from the details panel:
  Pre-select channel based on which tab user is on:
    Classroom tab → channel = 'classroom'
    Staff Room tab → channel = 'staff_room'
    Student Alley tab → channel = 'student_alley'

Run: next build
Commit: "fix: classroom details panel — remove ID, add city,
fix events globalId bug, event tile format"

---

## TASK 18 — Feature: share classroom link — full implementation [PENDING]

The share classroom link exists but the landing experience
for someone clicking it is not fully built.

Current: clicking the link likely goes to /classroom/[globalId]
which requires login and shows the classroom directly.

Full implementation needed:

FRONTEND — Public classroom preview page:
Create apps/web/app/classroom/[globalId]/preview/page.tsx
OR handle non-authenticated state in the existing page.

When a non-member (logged in or not) visits /classroom/[globalId]:
  Show a public preview page:
    Classroom name + institution (bold, centered)
    City + batch year
    Member count + verified count
    "X verified members · Est. [creation year]"
    Blurred/locked message preview (3-4 fake message bubbles)
      with overlay: "Join to see conversations"
    Upcoming events (public events only — classroom channel)
      shown as read-only tiles
    
    If NOT logged in:
      "Join this classroom" button → /auth/signup?redirect=/classroom/[globalId]
      "Already have an account? Sign in" → /auth/login?redirect=...
    
    If logged in but NOT a member:
      "Join this classroom" button → calls POST /memberships/join
      If verification required: shows verification methods after join
    
    If logged in and IS a member:
      Redirect to full classroom view immediately

BACKEND:
GET /classroom/:globalId/preview (public, no auth required)
Returns safe public data:
  name, institution name, city, batchYear, memberCount,
  verifiedCount, createdAt, requiresVerification
Does NOT return: messages, member list, private data

Share link format:
  https://alumtribe.com/classroom/[globalId]
  When shared via "Share classroom link" button:
    Copy to clipboard
    Show toast: "Link copied!"
    Link format should be human readable using globalId

SHARE BUTTON:
In the details panel "Share classroom link":
  On click: copy https://alumtribe.com/classroom/[globalId]
  to clipboard using navigator.clipboard.writeText()
  Show toast: "Classroom link copied to clipboard!"
  Replace current "Tap to copy" UI with this cleaner flow

Run: next build
Commit: "feat: classroom share link — public preview page,
join flow for non-members, copy to clipboard"

---

## TASK 19 — Feature: Connect tab — find and create classroom [PENDING]

Rename the "Create" tab in bottom nav to "Connect".
The Connect tab has two collapsible sections — only one
open at a time. Default: Find your batch expanded.

Read apps/web/components/layout/AppShell.tsx
Update bottom nav tab:
  Label: "Connect" (was "Create")
  Icon: ti-plug or ti-network (connection icon)
  Route: /connect

Create apps/web/app/connect/page.tsx

Page layout:

Header: "Connect" (bold 18px)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — Find your batch (default expanded)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Accordion header (tappable, toggles section):
  ▼ "Find your batch" (bold 14px) when expanded
  ► "Find your batch" when collapsed
  Chevron rotates on toggle (CSS transition)
  Tapping this collapses Find and expands Create

Expanded content:
  All search fields optional except institution:

  Institution (required):
    Searchable dropdown — same API as create classroom
    GET /v1/institutions/search?q=[query]
    300ms debounce, min 2 chars
    Shows: name + city + type badge

  Country (optional):
    Select dropdown — same country list as create classroom
    Default: India (IN)

  City (optional):
    Text input, placeholder "e.g. Kolkata"

  Batch year (optional):
    Select dropdown, current year to 1960, newest first

  Section/Program (optional):
    Text input, placeholder "e.g. 9A or MBA"

  [Search] button (primary, full width)
    On click: GET /v1/classrooms/search with all params
    Body: { institutionId?, country?, city?, year?, section? }

  Results (below button):
    Each result as a compact card:
      Institution icon + classroom name + batch year
      Member count (muted)
      Verification badge if required
      "Join" button (ghost, brand primary)
      On Join: POST /v1/memberships/join
        { classroomId, role: user's active_persona }
      On success: show toast "Joined! Verify to start posting"
      Navigate to: /classroom/[globalId]

    Empty results: "No classrooms found.
    Try different filters or create a new one below."

    Loading: skeleton cards

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — Create a classroom (default collapsed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Accordion header (tappable, toggles section):
  ► "Create a classroom" (bold 14px) when collapsed
  ▼ "Create a classroom" when expanded
  Tapping this collapses Create and expands Find

Expanded content:
  Same form as current /classroom/create page
  Reuse the same component/form
  On successful creation: navigate to /classroom/[globalId]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACCORDION BEHAVIOUR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Only one section open at a time.
Smooth height animation on expand/collapse (CSS transition).
Default state on page load: Find expanded, Create collapsed.
State resets on tab navigation (always opens with Find expanded).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add/update GET /classrooms/search endpoint:
  Auth: required
  Query params: institutionId?, country?, city?, year?, section?, limit?
  Returns classrooms the user is NOT already a member of
  Joins with institutions for filtering
  Returns: globalId, name, institution name, batchYear,
           section, memberCount, verificationRequired, city

Run: npm run test and next build
Commit: "feat: Connect tab — find your batch + create classroom
accordion, classroom search with filters"

---

## TASK 20 — Feature: messages tab — new conversation search [PENDING]

The messages tab needs a "+" button to start new conversations
by searching any user on the platform by name or email.

Read apps/web/app/messages/page.tsx

ADD "+" button to messages header:
  Position: top right of the "Messages" heading row
  Icon: ti-edit or ti-pencil-plus (20px)
  On click: opens new conversation search overlay

NEW CONVERSATION SEARCH OVERLAY:
  Full screen overlay or bottom sheet
  Header: "New message" + X close button

  Search input (auto-focused on open):
    Placeholder: "Search by name or email..."
    Calls GET /v1/users/search?q=[query] (300ms debounce, min 2 chars)
    Single endpoint handles both name and email search

  Search results:
    Each result as a row:
      Avatar (40px circle, initials fallback, colored)
      Full name (bold 13px)
      Shared classroom name if any (muted 11px)
        e.g. "Also in KV Fort William"
        If no shared classroom: just show name, no subtitle
      DO NOT show email — email is private
    Tap row → opens DM thread with that person
    Navigate to /messages?userId=[userId]
    Close overlay

  Empty state (no results):
    "No users found for '[query]'"

  Loading: 3 skeleton rows

BACKEND:

Add GET /v1/users/search
Auth: required
Query: q (min 2 chars, max 100 chars)
Logic:
  If q contains '@': exact match on profiles.email
    Return 0 or 1 result
  Otherwise: ILIKE search on profiles.full_name
    Return up to 10 results ordered by name

Returns (never include email in response):
  [{ id, full_name, avatar_url, sharedClassroom?: { name, globalId } }]

sharedClassroom: find first classroom both users share
  JOIN memberships on user_id = current user AND other user
  Return the classroom name if found, null if none

Exclude current user from results.

Log:
  debug: '[USERS:search] entry' { query, userId }
  debug: '[USERS:search] result' { count, type: 'email'|'name' }
  error: '[USERS:search] failed' { error: full }

Run: npm run test and next build
Commit: "feat: messages tab — new conversation search by name or email,
+ button, search overlay, shared classroom context"

---

## TASK 21 — Fix: classroom view — match mockup exactly [PENDING]

The classroom view is far from the mockup. This task
brings it in line with the original design.

Read alumini-demo.html screen s2 carefully.
Read apps/web/app/classroom/[globalId]/page.tsx

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX A — Header
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Layout (left to right):
  ← back arrow (white, 20px)
  Institution icon (32px rounded square, emoji on colored bg)
  "[Institution] · [Section] · [Year]" (white bold 14px)

Stats row below:
  👥 [memberCount]  ✓ [verifiedCount]  ✗ [pendingCount]
  Icons only — no text labels
  White 60% opacity, 11px, space-separated

Background: solid dark purple #1c1c2e
No gradient needed — solid is cleaner

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX B — Tab bar with ⓘ on active tab
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Remove the standalone "+" button from the tab bar entirely.
Instead add a small ⓘ icon AFTER the active tab label:
  "Classroom ⓘ"  |  Staff Room  |  Student Alley

The ⓘ is only shown on whichever tab is currently active.
On click: opens the details panel (same as before).
When tab changes: ⓘ moves to the new active tab.

Tab bar styling:
  background: same dark purple as header
  Active tab: white bold, bottom border 2px white
  Inactive: white 50% opacity
  ⓘ icon: white 60%, 14px, margin-left 4px

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX C — Message avatars with initials
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Each message shows:
  Avatar circle (28px):
    If profile photo: show photo
    If no photo: show initials (first letter of first + last name)
      e.g. "Rahul Agarwal" → "RA"
      e.g. "Ghosh Sir" → "GS"
    Background color: deterministic from name
      (same 6-color palette used elsewhere)

  Name above bubble: "[First name] [Last name initial]."
    e.g. "Rahul A." not full name — saves space
    For teachers: show role badge inline
      "Ghosh Sir · Teacher" (Teacher = small purple pill)

  Own messages: no avatar, no name, right-aligned

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX D — Event tile in chat (match mockup)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Event messages render as a special card in the chat flow:

Header bar (dark purple, full width of card):
  🎉 "Event · [CreatorFirstName] created"
  Small, white, padding 6px 12px

Card body (white):
  Event name (bold 16px)
  📅 [date]  📍 [location] — on one line, muted 12px

  Attendee avatars row:
    Show first 3-4 going attendees as small overlapping circles
    Each: 24px circle with initials or photo
    "+N more" if more than 4 going
    "[N] going" count (muted 12px) beside avatars

  RSVP buttons row:
    "✓ Going" pill (green bg if selected, ghost if not)
    "Pass" pill (ghost, gray)
    "? Maybe" pill (amber bg if selected, ghost if not)
    Tapping updates RSVP immediately (optimistic)

  Card border-radius: 12px
  Shadow: subtle 0 2px 8px rgba(0,0,0,0.08)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX E — Message input with attachment
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Message input bar (fixed bottom):
  Left: 📎 paperclip icon (ti-paperclip, 20px, muted)
    On click: opens file picker (images + documents)
    (Full attachment feature is TASK 09 in TASKS_08 — deferred)
    For now: show the icon, on click show "Coming soon" toast
  Center: text input "Write a message..."
  Right: send button (purple circle, arrow icon)

Input bar background: white
Border-top: 1px var(--color-border)
Padding: 8px 12px

Run: next build
Commit: "fix: classroom view matches mockup — header, tab ⓘ button,
message avatars with initials, event tile, attachment icon"

---

## TASK 22 — Fix: profile page — match mockup layout [PENDING]

Read apps/web/app/profile/page.tsx
Read alumini-demo.html screen s6

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX A — Stats row (3 columns)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Replace current stats with:

Column 1: 🏫 [institutionCount]
  Count of unique institutions across all memberships
  Label: "Institutions" (muted 10px below number)

Column 2: 💛 [connectionCount]
  Sum of ALL members across all user's classrooms
  (deduplicated — same person in 2 classrooms counts once)
  Label: "Connections" (muted 10px)

Column 3: 📅 [memberSince]
  Formatted join date e.g. "Sept 2026"
  Label: "Member since" (muted 10px)

Icons above the number (small, 20px)
Number: bold 20px
Borders between columns

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX B — Current role section
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add section below stats row:

Section heading: "Current role · self-reported" (muted 10px)

If role is set (linkedin_headline or profile job title):
  White card:
    💼 icon (28px circle, light purple bg)
    Job title (bold 13px)
    Company · City (muted 11px)

If role NOT set:
  White card (dashed border, muted):
    💼 icon (muted)
    "Define your current role" (muted 13px, italic)
    Tappable → opens edit profile with focus on role field

Fields to use (check which exist in profiles table):
  linkedin_headline → job title
  linkedin_company → company
  linkedin_location → city
  If LinkedIn not connected: check if we have custom
  job_title, company, location fields
  If not: add them to profiles table in fileUpdates.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX C — Education section (replaces "Your classrooms")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rename section from "YOUR CLASSROOMS" to "Education"
Section heading: "Education · [status]"
  If all verified: "Education · verified" (green dot)
  If any pending: "Education · pending" (amber dot)

Each classroom row (NOT a full ClassroomCard — compact row):
  Left: institution icon (32px rounded square)
    School → 🏫 on green bg
    University → 🎓 on purple bg
  Center: "[Institution] · [Section] · [Year]" (13px)
    e.g. "MP Birla · Class 9A · 2012"
    e.g. "UC Davis · MBA · 2025"
  Right: verification status icon only:
    ✓ green circle = verified
    ⏳ amber = pending
    ✗ red = rejected

  No member count, no location, no chevron
  Tappable → navigates to /classroom/[globalId]

  This frames classrooms as EDUCATION HISTORY
  not just chat groups — much more meaningful on a profile

Run: next build
Commit: "fix: profile page — stats row, current role section,
education section matching mockup"

Also add to fileUpdates.md:
  If job_title, company, location columns missing from profiles:
  ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS location_city text;

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
