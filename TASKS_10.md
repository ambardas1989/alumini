# AlumTribe — Task Batch 10

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_10.md along with the code changes
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

## CONTEXT — Manual Supabase changes applied during testing

The following columns were added directly in Supabase SQL Editor
on 2026-10-04 and are NOT yet in the migration files.
Claude Code must add these to the appropriate migration files
as part of TASK 01 below.

profiles table:
  company text
  job_title text
  birthday_month integer CHECK (birthday_month BETWEEN 1 AND 12)
  birthday_day integer CHECK (birthday_day BETWEEN 1 AND 31)
  location_city text
  location_lat numeric(9,6)
  location_lng numeric(9,6)
  work_start_date date
  work_company text
  bio text
  website text

events table:
  channel text CHECK (channel IN ('classroom','student_alley','staff_room'))
  DEFAULT 'classroom'

messages table:
  message_type constraint updated to include:
  'announcement', 'visiting_city', 'poll'
  (was only: 'text', 'event_card', 'system', 'attachment')

---

## TASK 01 — Chore: sync manual Supabase changes to migration files [DONE]
Note: events.channel already matched (025_events_channel.sql, from TASKS_08). Widened 029_message_visiting_city_type.sql's CHECK in place to add 'poll' (no 'poll' migration existed before). Added company/job_title/location_city/location_lat/location_lng/work_company/bio/website to 030_work_anniversary.sql's ALTER TABLE profiles (closest existing profiles migration; birthday_month/day and work_start_date already covered by 027/030 so not repeated). Updated migrations README.md status to ✅ Run for both files per CONTEXT's confirmation. fileUpdates.md UPDATE 10 marked resolved; new UPDATE 11 documents today's full column/constraint list. No app code changed — this was a files-only sync, no migrations run.

Read fileUpdates.md in the project root.
Read the CONTEXT section above.

For each column and constraint change listed in CONTEXT:
  Find the appropriate migration file in supabase/migrations/
  Add the column or constraint using ADD COLUMN IF NOT EXISTS
  or DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT pattern.
  Do not create new migration files unless no appropriate
  file exists — add to the closest existing one.

Specifically:
  profiles columns → find the migration that creates profiles
    or the most recent profiles-related migration
  events.channel → supabase/migrations/025_events_channel.sql
    or wherever events table is defined
  messages message_type constraint → wherever messages
    table constraints are defined

Also update fileUpdates.md — add entries for each change
applied today that is not already documented there.

Do NOT run any migrations against Supabase.
Do NOT use Supabase CLI.
Just update the files to match what is already in production.

After all files updated:
Commit: "chore: sync manual Supabase column additions
and constraint updates to migration files"
Push.

---

## TASK 02 — Fix: Staff Room permission leak [DONE] — audited canAccessChannel(), corridor's read switch, frontend gating, both RLS SELECT/INSERT policies, and createClassroom()'s creator-role assignment: all already matched the matrix correctly with no creator bypass (see fileUpdates.md UPDATE 12). Added an explicit redundant staff_room role re-check + the required warn log in corridor.service.ts sendMessage() as defense-in-depth per the task's literal instruction.

CRITICAL SECURITY FIX. Do this before anything else after TASK 01.

Staff Room must be strictly accessible to teachers and admins only.
Students must never be able to read or post in Staff Room regardless
of any other condition including being the classroom creator.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHANNEL ACCESS MATRIX (source of truth)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Role      | Classroom | Student Alley | Staff Room
  ----------|-----------|---------------|------------
  Student   |     ✓     |       ✓       |     ✗
  Teacher   |     ✓     |       ✗       |     ✓
  Admin     |     ✓     |       ✗       |     ✓

This matrix is absolute. No exceptions for creators,
early members, or any other condition.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/backend/src/modules/membership/membership.service.ts
Find canAccess() or equivalent channel permission check.

Fix the logic to match the matrix above exactly:
  staff_room: role must be 'teacher' OR 'admin'
  student_alley: role must be 'student'
  classroom: any verified role

Also fix in the message SEND endpoint:
Read apps/backend/src/modules/corridor/corridor.service.ts
The send message handler must re-validate channel access
based on role before inserting. Do not rely only on
canAccess() — add an explicit role check for staff_room.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUPABASE RLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read supabase/migrations/ — find the messages RLS policies.

Ensure the INSERT policy for messages enforces:
  staff_room channel → role IN ('teacher', 'admin')
  student_alley channel → role = 'student'
  classroom channel → any verified role

Update the migration file to match. Do not run against
Supabase — add to fileUpdates.md for manual application.

Log:
  warn: '[CORRIDOR:send] channel access denied'
  { userId, classroomId, channel, role }

Run: npm run test
Commit: "fix: enforce strict channel access - staff room
blocked for students at service and RLS level"
Push.

---

## TASK 03 — Fix: classroom creator role follows persona [DONE] — createClassroom() already honored dto.creatorRole from an earlier fix (TASKS_08 TASK 03) but only allowed 'student'/'teacher'; widened CreateClassroomDto, the service's creatorRole type, and apps/web/lib/api.ts to also accept 'admin', and ClassroomCreateForm now maps activePersona 'school_admin' to creatorRole 'admin' (previously fell through to 'student').

When a user creates a classroom, their membership role must
match the persona/role they selected during classroom creation,
not default to 'admin'.

The creator tag is stored as verification_method: 'creator'.
The role is separate and must follow what the user selected.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/backend/src/modules/classroom/classroom.service.ts
Find the createClassroom() method.
Find where the creator membership is inserted after classroom
creation — it currently hardcodes role: 'admin'.

Fix:
  Accept the creator's intended role from the request DTO.
  Valid values: 'student' | 'teacher' | 'admin'
  Use that role when inserting the creator membership.
  Keep verification_method: 'creator' and
  verification_status: 'verified' unchanged.

Read apps/backend/src/modules/classroom/dto/
Find CreateClassroomDto — add creatorRole field:
  creatorRole: 'student' | 'teacher' | 'admin'
  Default to 'student' if not provided.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/classroom/create/page.tsx or equivalent.
Find the classroom creation form.

The form already has an institution type or role selection.
Ensure the selected role is passed as creatorRole in the
POST /v1/classrooms request body.

If no explicit role selector exists in the form:
  Derive from the user's active_persona on their profile:
  active_persona 'alumni' → role 'student'
  active_persona 'teacher' → role 'teacher'
  active_persona 'admin' → role 'admin'

Run: npm run test
Commit: "fix: classroom creator role follows selected
persona, not hardcoded admin"
Push.

---

## TASK 04 — Fix: cover photo upload 403 [DONE] — audited the controller route and the guard: the reported error text only exists in VerificationService.assertClassroomAdmin() (a private method on a different module, unreachable from this upload path), and the existing guard already always passed for admin/creator, so the described 403 couldn't reproduce as-is. Applied the requested tightening anyway: assertCanUploadCover() now requires verified + (role='admin' OR is_creator) instead of TASKS_09 TASK 15 FIX C's "any verified member", and renamed the upload success/failure logs to the requested [CLASSROOM:coverPhoto] tag. Storage upload already used the service-role client.

Uploading a cover photo to a classroom returns 403:
"Only a verified admin of this classroom, or an active
school admin of its institution, can review verification
requests"

This is the wrong guard being applied — the verification
review guard is incorrectly placed on the cover photo
upload route.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/backend/src/modules/classroom/classroom.controller.ts
Find the cover photo upload endpoint.
Check which guard is applied to it — remove the verification
review guard and replace with a simpler check:
  User must be a verified member of the classroom.
  Role must be 'admin' OR verification_method = 'creator'.

The upload itself must route through the backend service role
(same pattern as avatar upload) — never direct client upload.

Check apps/backend/src/modules/classroom/classroom.service.ts
Find uploadCoverPhoto() or equivalent.
Ensure it uses supabaseAdmin (service role key) not the
anon client for the storage upload.

Log:
  info: '[CLASSROOM:coverPhoto] uploaded'
  { classroomId, userId, url }
  error: '[CLASSROOM:coverPhoto] failed' { error: full }

Run: npm run test
Commit: "fix: cover photo upload uses correct guard
and backend service role"
Push.

---

## TASK 05 — Fix: message button on verification card [DONE] — the Message button itself (MemberListModal.tsx) already navigated directly with the known userId. The actual 403 was one level deeper: ThreadView.tsx (the shared /messages?userId= thread page every Message button lands on) called api.getStudentProfile(), which hits the teacher-only GET /search/students/:userId for every thread opened by any non-teacher. Added an unrestricted GET /dm/conversations/:userId/profile (DmService.getRecipientProfile()) and pointed ThreadView at it instead.

Tapping "Message" on a student's verification/pending card
calls GET /v1/search/students/:id which requires teacher
persona and returns 403 for students and admins.

The fix is simple — the button already has the user ID.
It does not need to call any search endpoint.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Find the verification/pending members list component.
Find the "Message" button on each member row.

Change the onClick handler from calling the search endpoint
to directly navigating:
  router.push('/messages?userId=' + member.userId)

Or if using a DM composer function:
  openDM(member.userId)

No API call needed. The user ID is already in the component.

Run: next build
Commit: "fix: message button on verification card uses
userId directly instead of calling search endpoint"
Push.

---

## TASK 06 — Fix: classroom search grade and section split [DONE] — connect/page.tsx's "Find your batch" form had one combined "Section / Program" field (placeholder "e.g. 9A or MBA") sent wholesale as the `section` param. Split into Grade+Section inputs for schools / Program input for colleges (same type-based split ClassroomCreateForm already uses). Backend search-filtered endpoint now takes grade/section/program as separate params and filters with exact eq() on the classrooms.grade/section columns (which already existed) instead of ilike-ing a combined string against section/program — simpler and more correct than the ILIKE-on-name fallback the task suggested, since a real grade column was already there.

The classroom search is sending the grade number as the
section value. e.g. searching "Grade 10, Section C" sends
section=10 instead of section=C.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read the classroom search/filter component.
Find where grade and section are collected from the user.

Split into two separate fields:
  Grade: number input or dropdown (1-12 for schools,
    or program name for colleges)
  Section: single letter input or dropdown (A, B, C etc)

When building the search query:
  Send grade separately (for name/program filtering)
  Send section as just the letter (maps to DB section column)

The backend search endpoint should filter:
  section = 'C' (just the letter, exact match)
  name ILIKE '%10%' OR name ILIKE '%Grade 10%'
    (for the grade number)

Check apps/backend/src/modules/classroom/classroom.controller.ts
Find the search-filtered endpoint.
Ensure it handles grade and section as separate params.

Run: npm run test and next build
Commit: "fix: classroom search splits grade and section
into separate fields"
Push.

---

## TASK 07 — Fix: announcement and visiting city cards show on wrong side [DONE] — MessageBubble.tsx already received an `isOwn` prop (used by text/deleted messages) but the announcement/visiting_city branches rendered their card outside the row/rowOwn flex wrapper with no alignment at all, so they always sat flush-left. Added margin-inline-end:auto (default) / announcementCardOwn and visitingCityCardOwn modifier classes (margin-inline-start:auto) applied when isOwn, leaving the border/colors untouched.

Announcement and visiting_city message cards always render
on the left side of the chat regardless of who sent them.
They should follow the same alignment as text messages:
  sent by current user → right side
  sent by anyone else → left side

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read the message list/chat component.
Find where message_type = 'announcement' and
message_type = 'visiting_city' are rendered.

Add the same isMine check used for text messages:
  const isMine = message.sender_id === currentUserId
  Apply right alignment and appropriate styling when isMine.

The card visual design stays the same (purple left border
for announcements, accent for visiting city) — only the
horizontal alignment and bubble direction changes.

Run: next build
Commit: "fix: announcement and visiting city cards align
right when sent by current user"
Push.

---

## TASK 08 — Fix: message container scroll [DONE] — .messageList/.channelBody/header/tabs/input-bar already had the correct flex:1/min-height:0/flex-shrink:0 CSS; the actual bug was two levels up in the shared layout.css: .app-shell only has min-height:100dvh (no height/overflow:hidden) and .app-content has no display:flex, so .channelBody's flex:1 had no bounded flex ancestor to size against and the whole page grew with the message list instead. Added opt-in .app-shell--fixed-height/.app-content--flex modifiers (AppShell's new `fixedHeight` prop) rather than changing the shared defaults, which every other page relies on for normal page scrolling. Applies to all three channel tabs since they share this one page's layout.

When the message list gets long, the browser page scrolls
instead of the message container scrolling internally.
The scrollbar should be on the message container only.
The outer page should never scroll.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read the classroom chat layout component.
Find the message list container div.

Fix the CSS:
  Message container: flex:1, overflow-y:auto,
    min-height:0 (critical for flex children to scroll)
  Outer page/layout wrapper: overflow:hidden,
    height:100vh or 100%
  The input bar at the bottom must be fixed/sticky,
    never pushed off screen

The layout should be:
  Page: display:flex, flex-direction:column, height:100vh,
    overflow:hidden
  Header/tabs: flex-shrink:0
  Message container: flex:1, overflow-y:auto, min-height:0
  Input bar: flex-shrink:0

Check that this fix applies to all three channel tabs:
  Classroom, Student Alley, Staff Room

Run: next build
Commit: "fix: message container scrolls internally,
page no longer scrolls"
Push.

---

## TASK 09 — Feature: "+" menu super feature placeholders [DONE] — added a "Coming soon" divider and four greyed-out, no-hover items (Memory vault 🔐, Yearbook 📸, Challenge ⚡, Live session 🎥) below the existing Photo/File/Announcement/Visiting-a-city items in MessageInput.tsx's attach menu, each firing its own toast. This codebase has no icon library wired into the attach menu (every existing item is a plain emoji, no Tabler/icon-font import anywhere) — used the 🔐 emoji fallback the task explicitly allows for Memory vault rather than introducing a new icon dependency for one menu.

Add greyed-out placeholder items to the "+" menu for
super features that are not yet built. Tapping any of
these shows a "Coming soon" toast or inline message.
They should be visually distinct from active menu items
to make clear they are not yet available.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read the "+" menu component in the chat input area.

Add the following items BELOW all existing active items,
separated by a subtle divider:

  Small divider with label "Coming soon" in muted text

  🔐 Memory vault
      Label: "Memory vault"
      Muted grey color, no hover effect
      On tap: show toast "Memory vault — coming soon"

  📸 Yearbook
      Label: "Yearbook"
      Muted grey color
      On tap: show toast "Yearbook — coming soon"

  ⚡ Challenge
      Label: "Challenge"
      Muted grey color
      On tap: show toast "Challenges — coming soon"

  🎥 Live session
      Label: "Live session"
      Muted grey color
      On tap: show toast "Live sessions — coming soon"

Note on Memory vault icon: use a vault/safe icon not a
hourglass or capsule. Use the closest available icon from
the existing icon library (Tabler: ti-safe, or similar).
If no vault icon is available use 🔐 emoji as fallback.

Active items above the divider remain unchanged:
  Photo, File, Announcement, Visiting a city

Run: next build
Commit: "feat: add coming soon placeholders for super
features in + menu"
Push.

---

## TASK 10 — UI: Find your batch and Create classroom landing [DONE] — NewUserLanding.tsx's actionGrid was a 2-column grid of two visually-identical cards. Restacked into a column; "Find your batch"/"Find your institution" is now a large primary-colored full-width card (48px icon, 16px bold heading, 12px subtitle, CTA arrow), "Create a classroom"/"Request institution" stays a smaller outlined secondary card. Search input's card got a primary-tinted border + 16px radius and a larger font-size via a new className passthrough on Input. No onClick/logic changed.

The new user landing screen (TASK 01 from TASKS_09, currently
deferred) has a "Find your batch" and "Create a classroom"
section that needs better visual presentation. The two
actions need clearer hierarchy and more visual weight.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/(home)/page.tsx or wherever the empty
state / new user landing is rendered.

Find the "Find your batch" and "Create a classroom" actions.

Improve the visual presentation:
  Primary action (Find your batch):
    Large card, full width
    Big icon (48px) centered
    Bold heading (16px)
    Subtitle (12px muted)
    Brand primary background or strong border
    Clear CTA button

  Secondary action (Create a classroom):
    Slightly smaller or outlined card below
    Same structure but visually secondary
    Ghost button or outline style

  Spacing: generous padding, rounded corners (16px)
  Both cards should feel tappable and inviting

  If a search input is present on this screen:
    Make it prominent, auto-focused, large placeholder text
    "Search your school or college..."

Do not change any logic — only visual presentation.

Run: next build
Commit: "ui: improve find your batch and create classroom
landing screen visual presentation"
Push.

---

## COMPLETION SUMMARY

Date completed: 2026-10-04
Tasks completed: 10/10 (TASK 01 through TASK 10, all [DONE])
Tests passing: yes — full workspace suite (backend + utils) green after every task
Build status: yes — `next build` green after every frontend-touching task (03, 05–10)
Notes: Several tasks (02, 04) described bugs that no longer reproduced in the
current code — each was independently audited (service guard, read-side
switch, frontend gating, RLS policies) and found already correct, most
likely fixed in an earlier TASKS_08/09 session. Rather than skip those,
applied the task's literal requested changes anyway as explicit
defense-in-depth / intentional policy tightening, and documented the audit
findings in both TASKS_10.md's own per-task notes and fileUpdates.md
(UPDATE 12) so a future session doesn't re-investigate from scratch. TASK 05's
real bug turned out to be one level removed from where the task description
pointed (ThreadView.tsx, not the Message button itself) — found by tracing
the actual call chain rather than only the named component. TASK 06 used a
simpler, more correct fix (exact match on the classrooms.grade/section
columns, which already existed) than the task's suggested ILIKE-on-name
fallback.

---

## RESUMPTION GUIDE

Paste this to resume after any interruption:

"Read TASKS_10.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
