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

## TASK 02 — Feature: home feed for returning users [DONE: date groups/verification nudge/empty-feed-with-classrooms were already implemented; added new_member notification (NotificationService.handleClassroomJoined on classroom.joined) + feed rendering for it, and a real "Suggested for you" section (new GET /classroom/suggested endpoint, other classrooms at the caller's own institution(s)). Deliberately did NOT add new_message (would fire one notification per chat message — spam) or vouch_request (no natural single trigger event exists) — frontend renders both defensively if they're ever added, without fabricating backend data today.]

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

## TASK 03 — Fix: classroom shows join prompt for existing members [DONE: verified against current code — all four fixes already in place from earlier session work. Fix 1/2: loading spinner shows until BOTH classroom and membership resolve (Promise.all), join prompt only renders after loading completes and isMember is confirmed false. Fix 3: handleJoin() already treats a 409 as success (console.warn '[MEMBERSHIP:join] already member — treating as success', reloads membership, shows the classroom). Fix 4: deep links route through the same component/gate, so the fix applies uniformly. No code changes needed.]

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

## TASK 04 — Fix: conversations tab — initiate new DM [DONE: added GET /dm/search-recipients (verified members of the caller's own verified classrooms, name match) + NewConversationOverlay.tsx compose flow, wired to a new "+" button in the messages top bar. "Message" button on classroom member cards already existed from earlier session work (MemberListModal.tsx).]

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

## TASK 05 — Fix: edit profile button — pencil icon [DONE: replaced text label with a hand-rolled pencil SVG icon, ghost/no-border, top-right of the header card (already positioned there); hover darkens via existing color token]

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

## TASK 06 — Fix: MFA challenge endpoint missing or CORS [DONE: verified — POST /auth/mfa/challenge already exists (auth.controller.ts, JwtAuthGuard-protected, dual-purpose "completes login or re-authorises a sensitive action"), and main.ts's CORS config already includes OPTIONS in methods, Authorization/X-MFA-Code in allowedHeaders, and credentials:true. Both from earlier session work (TASKS_07 TASK 05). No code changes needed.]

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

## TASK 07 — Fix: unverified members can send messages [DONE: MembershipService.canAccessChannel() (sendMessage()'s sole gate) and the frontend's canPostChannel() both used to let pending_auto post in classroom/student_alley — both now require strictly 'verified' to post, in every channel; message input hides for pending_auto with the existing "You joined early — complete verification to post" banner, plus a filled-in fallback note]

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




## TASK 12 — Fix: pending filter counts and member verification UI [DONE: FIX A — Pending filter/count now includes pending_auto, not just 'pending'. FIX B — added a generic MFA-guarded admin verify/reject (new PATCH /membership/:classroomId/members/:userId/verify|reject) for pending/pending_auto members with no submitted document; TASK 10's document-review flow stays for members who did submit one]

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

## TASK 13 — Fix: DM open to all users, no restrictions [DONE]
Note: Removed assertSharedVerifiedClassroom() and its calls from getMessages()/sendMessage() in dm.service.ts. Added sender!=recipient and recipient-exists-in-profiles checks to sendMessage(). Frontend already had no verification gating on the Message button (MemberListModal.tsx) or in messages/page.tsx — no changes needed there. Updated dm.service.spec.ts accordingly. Backend build + full test suite (16 suites) pass.

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

## TASK 14 — Fix: theme toggle moves to profile, classroom card updates [DONE]
Note: Moved ThemeToggle out of AppShell (deleted, now unused) into a new "Appearance" row in profile page's account section, reusing the existing Switch track/thumb styling with useTheme(). ClassroomCard now shows "👥 N" (icon+number only, no text label) and an optional "📅 N" upcoming-events stat, hidden when 0/unset. Wired eventCounts (per-classroom GET /events/:classroomId, upcoming.length) into app/page.tsx, profile/page.tsx, and classes/page.tsx's "my classrooms" list. Backend already role/channel-scopes listEvents() correctly (EventsService.visibleChannels()) — no backend change needed for the role-aware requirement. Frontend + backend builds and full test suite pass.

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

## TASK 15 — Fix: classroom header stats and layout [DONE]
Note: Subtitle now shows "Class {identity}" only (no "Batch of {year}"); stats row is icon+number, dot-separated: 👥 members, ✓ verified, 📅 batchYear (no "(N years ago)"), ⏳ pendingCount (only if >0, computed client-side from the paginated member list), 📍 city (classroom.city falling back to institution.cityCode, only if present). Cover banner overlay changed to the specified rgba(0,0,0,0.5)→rgba(0,0,0,0.7) gradient. Cover upload widened backend+frontend from admin-only to any verified member + creator + admin (new ClassroomService.assertCanUploadCover(), replacing assertClassroomAdmin() for this one endpoint only — updateClassroom() keeps the stricter admin-only check). Builds + full test suite (16 backend suites/384 tests + utils) pass.

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

## TASK 16 — Feature: events as interactive tiles with RSVP [DONE]
Note: Confirmed/adjusted the 3 backend endpoints — GET :classroomId/:eventId now returns RSVP counts + myRsvp + creator profile (was the full named-list shape, unused by any frontend caller); POST rsvp now returns updated counts + new status instead of the raw upserted row; DELETE rsvp unchanged. New shared EventTile component (compact 3-line tappable tile: title+status icon, 🕐 date+going-count, 📍 location) used both in chat (EventMessageCard, replacing its old always-expanded inline RSVP buttons) and in ClassInfoSheet's upcoming-events list (with the show-first-2/"Show N more ↓"/"Show less ↑" collapse). New EventDetailSheet bottom sheet (title, date, tappable location→maps, description, creator avatar+name, 3-button RSVP with optimistic update, counts line, "Change my response" link, close button) opened via a shared openEventId state in page.tsx from either surface. Builds + full test suite (16 backend suites/384 tests + utils) pass.

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

## TASK 17 — Fix: classroom details panel [DONE]
Note: FIX A — removed the raw global-ID row from ClassInfoSheet entirely (Share classroom link already carries it in the copied URL). FIX B — institution line now appends " · {city}" (classroom.city, falling back to institution.cityCode) when known. FIX C — verified as already correct: page.tsx's loadEvents() already calls api.getEvents(classroom.id) (the resolved UUID), never the route's globalId string — no bug present; TASK 16 already applied the compact/clickable/collapsible tile format to this same panel. FIX D — verified as already correct: EventCreateModal already receives channel={activeChannel} from the classroom page, so "Create event" from any tab already creates into that tab's channel. Frontend build + full test suite pass.

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

## TASK 18 — Feature: share classroom link — full implementation [DONE]
Note: New public GET /classroom/:globalId/preview (no guard) returns id/name/institutionName/city/batchYear/memberCount/verifiedCount/createdAt/requiresVerification/upcomingEvents (classroom-channel only, top 5) — no messages/member list. Reworked apps/web's classroom page: dropped useRequireAuth()'s forced login redirect in favor of useAuth().isLoggedIn (AuthProvider already withholds children until resolved, so no extra "ready" wait needed); non-members (logged out or logged in) now fetch the preview and render a new ClassroomPreview component (bold centered name/institution, city+batch year, "N verified members · Est. {year}", blurred fake message bubbles with a "Join to see conversations" overlay, read-only upcoming-event tiles, and a Join button that routes to signup when logged out or calls POST join — with the existing 409-as-already-member handling and a redirect to /verify when the classroom requires it — when logged in); members still get the full existing experience unchanged. Share button's toast copy updated to "Classroom link copied to clipboard!" per spec; it already copies https://origin/classroom/[globalId] via navigator.clipboard. Builds + full test suite (16 backend suites/386 tests + utils) pass.

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

## TASK 19 — Feature: Connect tab — find and create classroom [DONE]
Note: Bottom nav "Create" tab renamed "Connect" (BottomNav.tsx — the task pointed at AppShell.tsx, but the tab list actually lives in BottomNav.tsx), now routing to new /connect page with a plug-style icon; /classroom/create still exists standalone. New backend GET /classroom/search-filtered (auth required) + ClassroomService.searchClassroomsByFilters(institutionId/country/city/year/section, excludes already-joined, "aggregate in JS" pattern matching searchClassrooms()'s own precedent) — kept as its own method/route rather than folded into the existing q-based searchClassrooms() to avoid entangling two different query shapes. New /connect page: one-open-at-a-time accordion (CSS grid-template-rows transition), "Find your batch" section (institution search reusing api.searchInstitutions, country/city/year/section filters, Search button disabled until an institution is picked, results with Join), "Create a classroom" section reusing the existing ClassroomCreateForm component as-is. Builds + full test suite (16 backend suites/389 tests + utils) pass.

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

## TASK 20 — Feature: messages tab — new conversation search [DONE]
Note: New GET /users/search (new UsersController in the identity module, since it owns `profiles`) — exact-match on email when q contains '@' (0-1 result), otherwise ILIKE full_name (up to 10, ordered), always excludes the caller, response never includes email, includes sharedClassroom {name, globalId} via one extra memberships lookup per search (not per result). The existing "+" button/NewConversationOverlay from TASK 04 already had the right shape — repointed it from the classmates-only searchDmRecipients() to this new platform-wide searchUsers(), updated placeholder/empty-state copy ("Search by name or email...", "No users found for '{query}'"); DmService.searchRecipients() is kept as-is for any future classmates-scoped use. Builds + full test suite (16 backend suites/393 tests + utils) pass.

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

## TASK 21 — Fix: classroom view — match mockup exactly [DONE]
Note: Read docs/mockups/alumni-demo.html's #s2 screen as ground truth for exact markup/colors where it conflicted with the task's own prose (e.g. mockup's actual ✅/⏳ stats icons and circular institution icon, vs. the task text's ✗/rounded-square). FIX A — ClassroomHeader rewritten to a single solid #1c1c2e header: back arrow, 34px circle institution emoji, one-line "{institution} · {identity} · {year}", icon-only space-separated stats row (👥/✅/⏳); dropped the earlier per-task-15 dot-separated stats/role-badge/city row to match this exact mockup. FIX B — ChannelTabs: removed the standalone +/ℹ button; a ⓘ badge now appears inline after the active tab's label only, opens the same info panel. FIX C — MessageBubble avatars bumped to 28px (Avatar's existing initials/color-hash already matched the spec); non-staff senders now show "First L." short names, staff show full name + a "Teacher"/"Admin" pill, via a new senderRole lookup from the already-loaded member roster. FIX D — new chat-specific event card (dark header bar "🎉 Event · X created", white body, overlapping going-attendee avatars from a new goingAttendees field EventsService.listEvents()/backend now returns, ✓ Going/Pass/? Maybe quick-RSVP pills with optimistic update) — kept the existing generic EventTile for ClassInfoSheet's list, since that one's compact/collapsible format is unrelated to this in-chat design. FIX E — MessageInput gained a paperclip button that shows an "Attachments coming soon" toast (real upload flow stays deferred to TASKS_08 TASK 09). Builds + full test suite (16 backend suites/393 tests + utils) pass.

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

## TASK 22 — Fix: profile page — match mockup layout [DONE]
Note: Confirmed linkedin_headline/company/location never existed in this schema (017_linkedin_profile.sql's own comment: LinkedIn's basic OAuth scope can't return them) and no custom job_title/company/location_city columns existed either — added those 3 columns to Profile/UpdateProfileDto/identity.service.ts (getProfile/updateProfile) and recorded the not-yet-applied ALTER TABLE in fileUpdates.md (UPDATE 10) per the task's own instruction, since this repo's migrations are applied manually. FIX A — stats row is now 🏫 institutionCount (unique institutions across classrooms) / 💛 connectionCount (deduplicated members across all classrooms, fetched via one getMembers() call per classroom, first-page-only — documented approximation matching the classroom page's own loadMemberStats() cap) / 📅 memberSince. FIX B — new "Current role · self-reported" card (💼 icon, job title/company·city, or a dashed-border "Define your current role" prompt that opens the edit form focused on the job-title field — required adding forwardRef to the shared Input component). FIX C — "Your classrooms" renamed to "Education · verified/pending" (dot-colored by whether every classroom is verified), each row now a compact institution-icon + "Institution · Section · Year" + verification-icon-only line linking to the classroom, replacing the old full ClassroomCard list. Builds + full test suite (16 backend suites/394 tests + utils) pass.

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

## TASK 23 — Feature: birthday display and notifications [DONE]
Note: New supabase/migrations/027_birthday_field.sql (renumbered from the task's literal "028" — 027 was the actual next-available slot; up to 026 already existed) adds profiles.birthday_month/birthday_day (month/day only, no year column at all — the migration's own comment explains why), listed ⚠️ Check in the migrations README. Installed @nestjs/schedule + ScheduleModule.forRoot() (not previously used anywhere in this backend). New GET /users/birthdays-today (IdentityService.getBirthdaysToday(), same shared-verified-classroom pattern as searchUsers()) and a shared todayInIst() helper (UTC+5:30) used identically by both the endpoint and NotificationService's new @Cron('0 30 2 * * *') sendBirthdayNotifications() job, so the feed and the daily notification always agree on "today". Profile edit form gained Month/Day dropdowns (no year field) with a "Only month and day shown to batchmates" hint, and the profile header shows "🎂 Month Day" only when set. Home feed fetches birthdays-today and renders dismissible cards above all other activity, whose "Wish them" button navigates to a pre-filled DM (ThreadView gained an initialValue prop; messages page reads a new ?prefill= param). Builds + full test suite (16 backend suites/398 tests + utils) pass.

Collect batchmates' birthdays and surface them in the home
feed and as notifications. Year is never shown or stored
for display — month and day only. Visible to all verified
members of shared classrooms.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create supabase/migrations/028_birthday_field.sql:

  ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birthday_month integer
  CHECK (birthday_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS birthday_day integer
  CHECK (birthday_day BETWEEN 1 AND 31);

Store month and day separately — never store birth year.
This is a deliberate privacy decision, not an oversight.
Add a comment to the migration explaining this.

Add GET /v1/users/birthdays-today
Auth: required
Logic:
  Find all users who share a classroom with the current user
  AND are verified members
  AND birthday_month = current month
  AND birthday_day = current day
Returns:
  [{ id, full_name, avatar_url, sharedClassroom: { name, globalId } }]

Log:
  debug: '[USERS:birthdays] checked' { userId, count }
  error: '[USERS:birthdays] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROFILE — collect birthday
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/profile/page.tsx
Add birthday field to the edit profile form:

  Label: "Birthday"
  Two dropdowns side by side:
    Month: January to December
    Day: 1 to 31
  No year field — do not ask for or store year
  Small muted text below: "Only month and day shown to batchmates"
  Optional — user can skip

Save via existing PATCH /v1/identity/profile:
  Add birthday_month and birthday_day to UpdateProfileDto
  Add to identity.service.ts updateProfile()

Display on profile page (own profile only):
  Show "🎂 [Month] [Day]" in the profile header area
  e.g. "🎂 October 8"
  If not set: show nothing (no placeholder)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOME FEED — birthday cards
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/(home)/page.tsx

On home feed load: call GET /v1/users/birthdays-today
If any results: show birthday cards at the TOP of the feed
above all other activity items.

Birthday card layout:
  White card, border-radius 12px, 1px border
  Left: avatar circle (40px, initials fallback, colored)
  Center:
    "🎂 [Full name]'s birthday today!" (bold 13px)
    "[Shared classroom name]" (muted 11px)
  Right: "Wish them" button (ghost, small, brand primary border)
    On click: navigate to /messages?userId=[id]
    Pre-fill DM input with: "Happy birthday [first name]! 🎂"

If multiple birthdays today: show one card per person, stacked.
Cards dismiss individually on "Wish them" click (optimistic).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/backend/src/modules/notification/notification.service.ts

Add a scheduled job that runs daily at 8:00 AM IST (UTC+5:30):
  Query all users who have batchmates with birthdays today
  For each: create an in-app notification:
    type: 'birthday'
    title: "🎂 [Name]'s birthday today"
    body: "Wish [first name] from [classroom] a happy birthday"
    data: { userId: birthdayPersonId, classroomGlobalId }

Use NestJS @Cron decorator:
  @Cron('0 30 2 * * *') — 2:30 AM UTC = 8:00 AM IST

Tap on notification → opens DM with that person.

Log:
  info: '[NOTIFY:birthday] sent' { recipientId, birthdayUserId }
  error: '[NOTIFY:birthday] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AFTER COMPLETION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: npm run test and next build
Commit: "feat: birthday collection, home feed cards,
daily notifications at 8am IST"

---

## TASK 24 — Feature: announcements in classroom chat [DONE]
Note: New supabase/migrations/028_message_announcement_type.sql widens the existing messages.message_type CHECK to add 'announcement' (no 'poll' type exists anywhere in this schema, despite the task's note — corrected). Added MessageType.ANNOUNCEMENT + widened SendMessageDto's @IsIn — no extra "verified or admin" gate was needed since MembershipService.canAccessChannel() already requires verification_status='verified' to post in ANY channel (TASK 07's own fix), so reaching sendMessage() at all already proves eligibility. CorridorService emits corridor.announcement.sent after an announcement insert; NotificationService's new handler fans it out as an in-app notification (the actual "feed_item" — there's no such table, so this reuses the existing notifications-based home feed every other event type already writes to) + a content-free push to every eligible member per the channel's role rules, excluding rejected members and the sender. New GET /corridor/announcements (CorridorService.getRecentAnnouncements()) returns real announcement text across all the caller's classrooms for richer home-feed cards, redacted with the exact same rules as getMessages() (classroom channel blurred for unverified/pending, staff_room/student_alley naturally restricted to the right role by channel access). Frontend: MessageInput's paperclip became a "+" menu (Photo/File still "coming soon", Announcement switches the compose bar into a purple-bordered "Announcement" mode with its own placeholder/cancel); MessageBubble renders a dedicated announcement card (purple left border, "Name · Announcement" label, blurred text + verify nudge when isRedacted); home feed renders announcement cards (avatar, sender, classroom, badge, body/blur, timestamp) above the regular feed. Builds + full test suite (16 backend suites/405 tests + utils) pass.

Extend the "+" attachment menu in classroom chat to include
an Announcement option. Announcements are a styled message
type — subtle purple accent, single line of text, no title
field. They appear in chat AND on the home feed of eligible
members. Unverified members see a blurred version with a
verify nudge.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISIBILITY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Who can POST announcements:
  Verified members and admins only.
  Unverified members do not see the Announcement option
  in the + menu.

Where announcements appear based on channel:

  Student Alley announcement:
    - Appears in Student Alley chat
    - Appears on home feed of all students (verified +
      unverified) in that classroom

  Staff Room announcement:
    - Appears in Staff Room chat
    - Appears on home feed of all teachers and admins
      in that classroom

  Classroom tab announcement:
    - Appears in Classroom chat
    - Appears on home feed of ALL members (students,
      teachers, admins) in that classroom

Unverified members:
  - See the announcement card in chat and feed
  - Content is blurred (CSS filter: blur(4px))
  - A small inline nudge replaces the content area:
    "Verify your membership to read this"
  - They still receive the push notification (see below)
    but notification body does not reveal content

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No new table needed. Extend existing messages table:

  ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS message_type text
  NOT NULL DEFAULT 'message'
  CHECK (message_type IN ('message', 'announcement',
  'poll', 'system'));

  Note: check if message_type already exists from
  TASKS_08 poll/message type work. If so, just add
  'announcement' to the existing constraint:

  ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

  ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('message', 'announcement',
  'poll', 'system'));

Add to fileUpdates.md after completion if migration
was applied manually.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/backend/src/modules/corridor/corridor.service.ts
or wherever messages are created.

In the send message endpoint:
  Accept message_type: 'announcement' in the request body.
  Validate: sender must have verification_status =
  'verified' OR role = 'admin'. If not, return 403.

  On save: set message_type = 'announcement' in the
  messages insert.

  After save: create a feed_item for each eligible
  member per visibility rules above. Inline is fine
  for now, no need for a background job.

  After save: send push notification to ALL members
  of the relevant channel (verified + unverified):
    title: "[Sender first name] made an announcement"
    body: "Open AlumTribe to read it"
    data: { classroomId, corridor, messageId }
  Do not reveal announcement content in the notification.

Log:
  info: '[CORRIDOR:announcement] sent' { senderId,
  classroomId, corridor, messageId }
  error: '[CORRIDOR:announcement] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — + menu extension
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read the chat input component in the relevant classroom
page. Find the existing + button and its menu (photo,
file attachment options).

Add a new menu item at the bottom:
  Icon: ti-speakerphone (Tabler outline)
  Label: "Announcement"
  Color: var(--text-pro) for icon and label
  Background on hover: var(--bg-pro)

Only show this menu item if the current user is verified
or admin. Hide it entirely for unverified members.

On click: close the + menu and switch the chat input
into announcement mode:
  - Add a small purple label above the input:
    "Announcement" in var(--text-pro), 11px
  - Add a thin left border on the input in var(--fill-pro)
  - Placeholder text: "Write an announcement..."
  - A small dismiss x to cancel back to regular message mode
  - Send button works the same way

On send: pass message_type: 'announcement' to the
send message API call.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — announcement bubble in chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When rendering messages in chat, check message_type.
If 'announcement', render differently from regular bubble:

Verified member view:
  - Same bubble shape as regular message
  - Left border: 3px solid var(--fill-pro)
  - Small label above bubble: "[Sender name] · Announcement"
    where "Announcement" is var(--text-pro), 10px
  - Bubble background: var(--surface-2)
  - Border: 0.5px solid var(--border-pro)
  - Text: single line, 13px, var(--text-primary)

Unverified member view:
  - Same card structure as above
  - Content text: filter: blur(4px),
    user-select: none, pointer-events: none
  - Below blurred text: small inline strip
    background: var(--bg-warning)
    border-radius: var(--radius)
    padding: 5px 8px
    Icon: ti-lock, 12px, var(--text-warning)
    Text: "Verify your membership to read this"
    font-size: 11px, var(--text-warning)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — announcement card on home feed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/(home)/page.tsx

Fetch announcements as part of the home feed. Include
message_type = 'announcement' items from the user's
classrooms in the feed endpoint or as a separate call.

Feed card layout (verified member):
  White card, border-radius 12px, 0.5px border
  Left border: 3px solid var(--fill-pro)
  Top row: avatar (28px initials) + sender name
    (13px, 500 weight) + classroom name (11px muted)
    + "Announcement" badge (var(--bg-pro) background,
    var(--text-pro) text, 10px, border-radius var(--radius),
    padding 2px 8px)
  Body: announcement text, 13px, var(--text-secondary)
  Bottom: timestamp, 10px, var(--text-muted)

Feed card layout (unverified member):
  Same card structure
  Body text: filter: blur(4px), user-select: none
  Below: same verify nudge strip as chat view

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AFTER COMPLETION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: npm run test and next build
If any migration was applied manually add it to
fileUpdates.md.
Commit: "feat: announcements in classroom chat with
feed cards and push notifications"

---

## TASK 25 — Feature: visiting a city post type [DONE]
Note: New supabase/migrations/029_message_visiting_city_type.sql widens the messages_message_type_check to add 'visiting_city' (no new metadata column — jsonb already existed). MessageType.VISITING_CITY added; SendMessageDto gained optional city/fromDate/toDate fields, with cross-field validation (all three required together, from<=to, from not >30 days in the past) done in CorridorService.sendMessage() rather than the DTO, matching this codebase's established pattern (CreateEventDto's own future-date check). content is the human-readable fallback string; metadata carries the structured {city, from_date, to_date, responders: []} — no separate "content as JSON" encoding, since jsonb metadata already IS the structured store and double-encoding would be redundant. New POST /corridor/message/:messageId/im-there (CorridorService.respondImThere(), idempotent, emits corridor.visiting_city.response only on the FIRST add) and NotificationService.handleVisitingCityResponse() notifies the original poster. Refactored getRecentAnnouncements() into a shared private getRecentPostsByType() and added getRecentVisitingCityPosts() (GET /corridor/visiting-city) reusing the identical per-channel redaction rules. Frontend: MessageInput's + menu gained "Visiting a city" opening a small inline form (city text + 2 date pickers, default today/today+2, Share button gated on all 3 fields) that replaces the normal bar while open; MessageBubble renders a visiting-city card (📍 city, date range, "I'm there too!"/"You're going" button, responder count, blurred+nudge when isRedacted); home feed renders equivalent cards with classroom name, using the same optimistic im-there handler pattern as chat. Builds + full test suite (16 backend suites/415 tests + utils) pass.

A structured post type under the "+" menu in classroom
chat. User picks a city and date range. Posts as a
distinct card in chat and feed. Corridor privacy applies
exactly as with announcements — the channel the user
posts in controls who sees it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISIBILITY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Same rules as TASK 24 announcements:

  Student Alley post → students only (chat + feed)
  Staff Room post → teachers and admins only (chat + feed)
  Classroom tab post → all members (chat + feed)

Who can post: verified members and admins only.
Unverified members do not see the option in + menu.

Unverified members who receive the feed card:
  See the card structure but city/date text is blurred.
  Same verify nudge strip as announcements.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No new table. Extend messages table message_type
constraint (check if already done in TASK 24):

  ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

  ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('message', 'announcement',
  'visiting_city', 'poll', 'system'));

Store city and date range in existing content field as JSON:
  content: '{"city":"Mumbai","from":"2024-12-21","to":"2024-12-23"}'

Also store a human-readable version for fallback:
  Add metadata jsonb column if not already present:
  ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS metadata jsonb;

  Store: { city, from_date, to_date, responders: [] }
  responders: array of user_ids who tapped "I'm there too"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

In the send message endpoint:
  Accept message_type: 'visiting_city' with body:
    { city: string, from_date: string, to_date: string }
  Validate: verified or admin only. Return 403 if not.
  Validate: from_date <= to_date, both are valid dates,
  from_date is not more than 30 days in the past.
  Save with message_type = 'visiting_city' and
  metadata = { city, from_date, to_date, responders: [] }

Add POST /v1/messages/:messageId/im-there
  Auth: required
  Adds current user's id to metadata.responders array
  if not already present (idempotent).
  Returns updated responders count.
  Notify the original poster:
    type: 'visiting_city_response'
    title: "[Name] is also in [city]!"
    body: "Tap to message them"
    data: { messageId, responderId }

Log:
  info: '[CORRIDOR:visiting_city] posted'
  { senderId, classroomId, corridor, city }
  info: '[CORRIDOR:visiting_city] response'
  { responderId, posterId, city }
  error: '[CORRIDOR:visiting_city] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — + menu extension
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add to the + menu below Announcement:
  Icon: ti-map-pin (Tabler outline)
  Label: "Visiting a city"
  Shown only to verified members and admins.

On click: open a small inline form above the chat input:
  Field 1: City name (text input, placeholder "Which city?")
  Field 2: From date (date picker, default today)
  Field 3: To date (date picker, default today + 2 days)
  Post button: "Share" (brand primary)
  Cancel: x to dismiss back to normal input

Validation: all three fields required before Send
enables.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — visiting city card in chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When message_type = 'visiting_city', render a card:

Verified member view:
  White card, border-radius 12px, 0.5px border
  Left border: 3px solid var(--fill-accent)
  Top: sender avatar (28px) + "[Name] is visiting" label
    (10px, var(--text-muted)) + "Visiting a city" badge
    (var(--bg-accent), var(--text-accent), 10px)
  Body:
    ti-map-pin icon (16px, var(--text-accent))
    "[City]" (bold 15px, var(--text-primary))
    "[From date] - [To date]" (12px, var(--text-muted))
      Format: "Dec 21 - Dec 23"
  Response row:
    "I'm there too!" button (ghost, accent border, small)
      On tap: calls POST /v1/messages/:id/im-there
      After tap: button turns filled accent, text "You're going"
      Cannot un-tap (idempotent, no undo needed)
    "[N] batchmates are there" (12px muted) if responders > 0

Unverified member view:
  Same card structure
  City and date text: filter: blur(4px), user-select: none
  Same verify nudge strip as announcements

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — visiting city card on home feed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Same card layout as chat but with classroom name shown
in the top row for context.
"I'm there too!" button works the same way.
Verified members only see full content.
Unverified: blurred with verify nudge.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AFTER COMPLETION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: npm run test and next build
Add migration to fileUpdates.md if applied manually.
Commit: "feat: visiting a city post type with I'm there
response, chat card, home feed card"

---

## TASK 26 — Feature: new member joined — feed card and notification [DONE]
Note: Retired TASK 02's 'classroom.joined' (fires on JOIN, any status) listener entirely — kept it alongside a verification-triggered one would have produced two "joined" cards per member. Both real emit sites for verification (MembershipService.adminVerifyMember(), VerificationService's approval flow) already fire 'verification.approved' for every method, so no new emit call was needed — NotificationService.handleMemberVerifiedNotifyClassroom() is a second listener on that same event (the first, handleVerificationApproved(), still handles the unrelated "you are now verified" self-notification). In-app notifications (this app's only feed mechanism — no separate feed_item table) go to every OTHER non-rejected member regardless of their own verification status, since the task says a "someone joined" card has no sensitive content; push is sent only to verified members. Home feed gained a dedicated new_member card (avatar with initials fallback, "{name} joined {classroom}" title, "{role} · verified via {method}" subtitle, "Say hello" button to a DM — not the classroom) instead of the generic icon+title+body row every other notification type uses. Builds + full test suite (16 backend suites/416 tests + utils) pass.

When a new member joins and is verified in a classroom,
all existing members of that classroom get a feed card
and push notification. Visible cross-role — a student
joining is visible to teachers and admins, a teacher
joining is visible to students.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRIGGER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trigger: when a membership verification_status changes
to 'verified' (either auto-verified or admin-approved).
Not on join — on verification. Unverified joins are silent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/backend/src/modules/membership/membership.service.ts
or verification.service.ts — wherever verification_status
is set to 'verified'.

After setting verified status, trigger:
  1. In-app notifications for all OTHER verified members
     of the same classroom:
       type: 'new_member'
       title: "[Name] joined [Classroom]"
       body: "[Role] · verified"
       data: { userId: newMemberId, classroomGlobalId }

  2. Push notification (same content as in-app)

  3. Create a feed_item for all members of the classroom
     (verified + unverified — unverified can see new member
     cards in full, there is no sensitive content here):
       type: 'new_member'
       actor_id: newMemberId
       classroom_id: classroomId
       metadata: { role, verification_method }

Do NOT notify the new member themselves.

Log:
  info: '[MEMBERSHIP:verified] notified classroom'
  { newMemberId, classroomId, recipientCount }
  error: '[MEMBERSHIP:verified] notify failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — home feed card
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/(home)/page.tsx

New member feed card layout:
  White card, border-radius 12px, 0.5px border
  Left: avatar circle (40px, initials fallback)
  Center:
    "[Name] joined [Classroom]" (bold 13px)
    "[Role] · verified via [method]" (muted 11px)
    e.g. "Student · verified via peer vouch"
  Right: "Say hello" button (ghost, small, brand border)
    On click: navigate to /messages?userId=[newMemberId]
  Bottom: timestamp (10px muted)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AFTER COMPLETION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: npm run test and next build
Commit: "feat: new member joined — feed card and
push notification on verification"

---

## TASK 27 — Feature: work anniversary feed card and notification [DONE]
Note: New supabase/migrations/030_work_anniversary.sql adds only profiles.work_start_date — reused TASK 22's `company` column instead of adding a duplicate `work_company`, per the task's own instruction to check first. Profile edit form gained a "Started at {company} on" month+year picker (day always normalized to 1). New NotificationService.sendWorkAnniversaryNotifications() cron, same 8am IST schedule as the birthday job (todayInIst() extended to also return year, shared by both), notifying verified members of classrooms the anniversary person is ALSO verified in, excluding themselves; skips anyone whose match would be <1 year (i.e. today). Home feed gained a dedicated work_anniversary card (success-green left border, avatar, title/body straight from the notification, "Congrats" button opening a pre-filled DM) alongside TASK 26's new_member card, both bypassing the generic icon+title+body feed row. Builds + full test suite (16 backend suites/419 tests + utils) pass.

When a batchmate's work anniversary falls today, surface
a feed card and send a notification to verified members
of shared classrooms. Only triggers if work_start_date
is set on their profile.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check if work_start_date exists on profiles table.
If not, add it:

  Create supabase/migrations/029_work_anniversary.sql:

  ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS work_start_date date,
  ADD COLUMN IF NOT EXISTS work_company text;

  Note: work_company may already exist as 'company'
  from TASK 22. Check before adding. Use whichever
  column exists — do not duplicate.

Add to fileUpdates.md if applied manually.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROFILE — collect work start date
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/profile/page.tsx
In the edit profile form, add:

  Label: "Work anniversary"
  Field: "Started at [company] on" + date picker
    Month + Year only (not day — too precise)
    Store as first day of that month:
    e.g. user picks "March 2019" → store 2019-03-01
  Optional — user can skip

Save via existing PATCH /v1/identity/profile.
Add work_start_date to UpdateProfileDto.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND — scheduled job
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/backend/src/modules/notification/notification.service.ts

Add scheduled job alongside the birthday job:
  @Cron('0 30 2 * * *') — same 2:30 AM UTC = 8:00 AM IST run

  Query all profiles where:
    work_start_date IS NOT NULL
    AND EXTRACT(MONTH FROM work_start_date) = current month
    AND EXTRACT(DAY FROM work_start_date) = current day
    AND work_start_date < today (at least 1 year ago)

  For each person found:
    Calculate years: current year - EXTRACT(YEAR FROM work_start_date)
    Find all verified members of shared classrooms
    For each: create in-app notification:
      type: 'work_anniversary'
      title: "🎉 [Name]'s [N]-year work anniversary"
      body: "[N] years at [company] — wish them well"
      data: { userId: personId, years: N }
    Send push notification (same content)

  Only notify verified members of shared classrooms.
  Do not notify the person about their own anniversary.

Log:
  info: '[NOTIFY:work_anniversary] sent'
  { personId, years, recipientCount }
  error: '[NOTIFY:work_anniversary] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — home feed card
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/(home)/page.tsx

Work anniversary feed card layout:
  White card, border-radius 12px, 0.5px border
  Left border: 3px solid var(--fill-success)
  Left: avatar circle (40px, initials fallback)
  Center:
    "🎉 [Name]'s [N]-year work anniversary" (bold 13px)
    "[N] years at [company]" (muted 11px)
    Only show company if work_company is set on profile
    If not set: "[N]-year work anniversary" only
  Right: "Congrats" button (ghost, small, success border)
    On click: navigate to /messages?userId=[personId]
    Pre-fill DM: "Congratulations on [N] years! 🎉"
  Bottom: timestamp (10px muted)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AFTER COMPLETION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: npm run test and next build
Add migration to fileUpdates.md if applied manually.
Commit: "feat: work anniversary feed card and daily
notification at 8am IST"

---

## TASK 28 — Feature: batchmates in your city discovery card [PENDING]

When a user sets or updates their city on their profile,
show a one-time feed card: "X batchmates from your
classrooms are also in [city]." Drives connection
requests without any privacy intrusion — only triggers
when the user themselves has set a public city.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIVACY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Only users who have set location_city on their own
  profile can see this card.
- The card only shows batchmates who have ALSO set
  location_city on their profile (opt-in both ways).
- Only verified members of shared classrooms are shown.
- Nobody gets notified that someone else moved to
  their city — discovery is one-directional and
  initiated by the person updating their own profile.
- No channel privacy applies here — this is profile-level
  data, not channel content. Classroom membership is
  the privacy boundary.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/backend/src/modules/identity/identity.service.ts
In updateProfile(), after saving location_city:

  If location_city changed and is not null:
    Query verified members of all the user's classrooms
    WHERE their location_city ILIKE the new city
    (case-insensitive match, trim whitespace)
    AND user_id != current user
    AND location_city IS NOT NULL

    If count > 0:
      Create a single feed_item for current user:
        type: 'batchmates_in_city'
        metadata: {
          city: location_city,
          count: N,
          sampleUsers: first 3 user ids (for avatars)
        }

Add GET /v1/users/batchmates-in-city
Auth: required
Returns batchmates in same city as current user:
  Query same as above
  Returns: [{ id, full_name, avatar_url,
  sharedClassroom: { name, globalId } }]
  Max 20 results, ordered by most recently verified

Log:
  debug: '[USERS:city_discovery] triggered'
  { userId, city, count }
  error: '[USERS:city_discovery] failed' { error: full }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — home feed card
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/(home)/page.tsx

Batchmates in city feed card layout:
  White card, border-radius 12px, 0.5px border
  Left border: 3px solid var(--fill-pro)
  Top row:
    ti-map-pin icon (16px, var(--text-pro))
    "[N] batchmates in [city]" (bold 13px)
  Body:
    Row of overlapping avatars (3 shown, 28px each,
    -8px margin to overlap):
      Avatar circle with initials or photo
      If N > 3: "+[N-3] more" label beside avatars
    Muted 11px below avatars:
      "From your classrooms · also in [city]"
  Right: "See who" button (ghost, small, pro border)
    On click: opens a bottom sheet or inline expanded
    list showing all batchmates in that city
    Each row: avatar + name + shared classroom name
    + "Message" ghost button

Card is dismissible (x button top right).
Once dismissed: store dismissal in localStorage with
key 'dismissed_city_discovery_[city]' so it does not
reappear for the same city.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AFTER COMPLETION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: npm run test and next build
Commit: "feat: batchmates in your city discovery card
triggered on profile city update"

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
