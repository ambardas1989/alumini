# AlumTribe — Task Batch 08

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_08.md along with the code changes
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

## TASK 01 — Fix: classes page layout — search and discovery [DONE: removed duplicate "Find your batch" CTA, hid My Classrooms search until non-empty, added a DISCOVER divider + heading above the discovery search]

The classes page has two search boxes stacked awkwardly
and a duplicate "Find your batch" button and search input.

Read apps/web/app/classes/page.tsx

Fix the page layout:

SECTION 1 — My Classrooms (top):
  Heading: "My Classrooms" (bold 18px)
  If user HAS classrooms:
    Search input: "Search your classrooms..." (filters the list)
    Classroom cards list below
  If user has NO classrooms:
    Skip the search input entirely
    Empty state:
      Graduation cap icon
      "You haven't joined any classrooms yet."
      "Find your batch and reconnect with your people."
      NO separate "Find your batch" button — let page flow
      naturally to the discovery section below

DIVIDER:
  Horizontal rule or section break
  Label: "DISCOVER" (10px uppercase muted centered)

SECTION 2 — Find your batch (below divider):
  Heading: "Find your batch" (bold 16px)
  Single search input: "Search by school, college or university..."
  Results appear below as cards
  Empty state: "Search for your school or college above"

STICKY BOTTOM:
  "+ New Classroom" button (always visible)

Remove the duplicate "Find your batch" button from
the empty state — the discovery section serves that purpose.

Run: next build
Commit: "fix: classes page layout — clear sections, no duplicates"

---

## TASK 02 — Fix: memberships verification_method constraint [PENDING]

Joining a classroom fails with:
"new row violates check constraint memberships_verification_method_check"
Because 'early_member' is not in the allowed values list.

Fixed manually in Supabase SQL Editor already.
This task saves it to a migration file.

Create supabase/migrations/023_membership_constraints.sql:

ALTER TABLE public.memberships
DROP CONSTRAINT IF EXISTS memberships_verification_method_check;

ALTER TABLE public.memberships
ADD CONSTRAINT memberships_verification_method_check
CHECK (verification_method IN (
  'creator',
  'early_member',
  'email_domain',
  'peer_vouch',
  'document',
  'linkedin',
  'institution_code',
  'admin'
));

Update supabase/migrations/README.md:
Add: | 023_membership_constraints.sql | ✅ Run | membership method constraint |

Run: npm run test
Commit: "fix: memberships verification_method constraint includes early_member"

---

## TASK 03 — Fix: classroom creator role matches persona [PENDING]

Currently creator always gets role='admin' regardless of persona.
This breaks channel access — a student creating a classroom
gets admin role and loses access to student alley.

New rules:
  Creator role = their persona (student or teacher)
  Creator verification_status = 'verified' (auto-verified)
  Creator verification_method = 'creator'
  Creator gets admin management rights (separate from role)
  Channel access based on role as normal:
    Student creator → classroom + student alley access
    Teacher creator → classroom + staff room access

BACKEND:

Read apps/backend/src/modules/classroom/classroom.service.ts
Find createClassroom() — where creator membership is inserted.

Change the membership insert to:
  role: persona from the request (dto.creatorRole or
        read from user's active_persona in profiles)
        If not provided: default to 'student'
  verification_status: 'verified'
  verification_method: 'creator'
  is_creator: true (add this column if missing)

Add is_creator column:
Create supabase/migrations/024_membership_is_creator.sql:

ALTER TABLE public.memberships
ADD COLUMN IF NOT EXISTS is_creator boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.memberships.is_creator IS
'True for the user who created this classroom.
 Creator gets management rights regardless of their role.
 Channel access is still determined by the role field.';

Update admin rights checks throughout the codebase:
Anywhere that checks role = 'admin' for management actions
(approve verifications, generate codes, remove members):
Also accept is_creator = true as sufficient permission.

Search for: .eq('role', 'admin') in membership queries
Replace with: .in('role', ['admin']).or('is_creator.eq.true')
Or add OR condition: role = 'admin' OR is_creator = true

FRONTEND:

Read apps/web/app/classroom/create/page.tsx
The create classroom form should pass the user's current
persona as creatorRole in the request body:
  { ...formData, creatorRole: currentPersona }
  where currentPersona = 'student' | 'teacher'

Read apps/web/components/ui/Badge.tsx
The 'creator' badge variant should already exist.
Confirm it shows correctly in the member list.

Run: npm run test — all tests pass
Run: next build
Commit: "fix: classroom creator role matches persona,
is_creator flag for management rights"

IMPORTANT: After pushing run in Supabase SQL Editor:
supabase/migrations/024_membership_is_creator.sql

---

## TASK 04 — Fix: classroom cover photo upload via backend API [PENDING]

Classroom cover photo upload fails with 400 from Supabase Storage:
POST .../institution-assets/classrooms/[id]/cover.jpeg 400

Same root cause as avatar upload — frontend uploads directly
to Supabase Storage using custom JWT which Supabase rejects.

Fix: route through backend API using service role key.

BACKEND:

Read apps/backend/src/modules/classroom/classroom.controller.ts

Add endpoint: POST /classroom/:globalId/cover
Auth: JwtAuthGuard — user must be creator or admin of classroom
Accepts: multipart/form-data, field name: 'cover'
Max size: 10MB
Allowed types: image/jpeg, image/png, image/webp

In the handler:
1. Verify user is creator or admin of this classroom
2. Upload to Supabase Storage using SERVICE ROLE client:
   bucket: 'institution-assets'
   path: classrooms/[classroomId]/cover.[ext]
   upsert: true
3. Get public URL
4. Update classrooms.cover_url with public URL
5. Return: { coverUrl: publicUrl }

Log:
  debug: '[CLASSROOM:cover] upload start' { classroomId, size, type }
  info:  '[CLASSROOM:cover] upload success' { classroomId, coverUrl }
  error: '[CLASSROOM:cover] upload failed' { classroomId, error: full }

Also add endpoint: POST /institution/:institutionId/logo
Same pattern for institution logos.
Auth: platform admin only.
bucket: 'institution-assets'
path: institutions/[institutionId]/logo.[ext]

FRONTEND:

Read apps/web/app/classroom/[globalId]/page.tsx
Find the cover photo upload handler.

Change from direct Supabase Storage upload to:
  const formData = new FormData()
  formData.append('cover', file)
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/classroom/${globalId}/cover`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData
    }
  )
  const { coverUrl } = await response.json()
  Update cover display with coverUrl

Error handling:
  413 → "File too large. Maximum size is 10MB."
  415 → "Invalid file type. Use JPEG, PNG or WebP."
  403 → "Only classroom admins can update the cover photo."
  Other → "Upload failed. Please try again."

Run: npm run test and next build
Commit: "fix: classroom cover and institution logo upload
routed through backend API"

---

## TASK 05 — Feature: events channel visibility [PENDING]

Events need channel-based visibility matching messages:
  Created in 'classroom' channel → visible to all members
  Created in 'staff_room' channel → visible to teachers/admins only
  Created in 'student_alley' channel → visible to students only

BACKEND:

Read apps/backend/src/modules/events/events.service.ts
Read apps/backend/src/modules/events/events.controller.ts

Check the events table schema — confirm it has a 'channel' column.
If missing, add to a migration:

Create supabase/migrations/025_events_channel.sql:

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS channel text
  NOT NULL DEFAULT 'classroom'
  CHECK (channel IN ('classroom', 'staff_room', 'student_alley'));

COMMENT ON COLUMN public.events.channel IS
'Channel this event belongs to. Controls visibility:
 classroom = all verified members
 staff_room = teachers and admins only
 student_alley = students only';

Update POST /events/:classroomId:
  Accept channel in request body (default: 'classroom')
  Validate user has access to that channel before creating:
    staff_room → user must be teacher or admin
    student_alley → user must be student
    classroom → any verified member

Update GET /events/:classroomId:
  Filter events by channel based on user's role:
    Students: return channel='classroom' OR channel='student_alley'
    Teachers/admins: return channel='classroom' OR channel='staff_room'
  Never return events from a channel the user cannot access

Update RLS policy on events table:
  Similar to messages RLS — filter by channel + membership role

Log:
  debug: '[EVENTS:create] entry' { classroomId, channel, userId }
  debug: '[EVENTS:get] entry' { classroomId, userId, visibleChannels }
  info:  '[EVENTS:create] success' { eventId, channel }
  warn:  '[EVENTS:create] access denied' { userId, channel, role }
  error: '[EVENTS:create] failed' { error: full }

FRONTEND:

Read apps/web/app/classroom/[globalId]/page.tsx
Find where events are displayed and created.

When creating an event:
  Pre-select channel based on current active tab:
    If on Classroom tab → channel = 'classroom'
    If on Staff Room tab → channel = 'staff_room'
    If on Student Alley tab → channel = 'student_alley'
  Show the channel as a label on the create form:
    "This event will be visible to: All members"
    "This event will be visible to: Teachers only"
    "This event will be visible to: Students only"

When displaying events:
  Filter/show only events the user has access to
  Show a small channel badge on each event card:
    classroom → no badge (default, everyone sees it)
    staff_room → "Teachers only" purple badge
    student_alley → "Students only" blue badge

Run: npm run test and next build
Commit: "feat: events channel visibility — classroom/staff_room/student_alley"

IMPORTANT: After pushing run in Supabase SQL Editor:
supabase/migrations/025_events_channel.sql

---

## TASK 06 — Feature: messages visible only from join date [PENDING]

Users should only see messages sent after they joined
the classroom. Historical messages before their join date
should not be visible — this is standard behaviour for
group chats (WhatsApp, Slack, Telegram all do this).

BACKEND:

Read apps/backend/src/modules/corridor/corridor.service.ts
Find getMessages() method.

Add join date filter to the messages query:

1. First fetch the user's membership joined_at for this classroom:
   const { data: membership } = await supabaseAdmin
     .from('memberships')
     .select('joined_at')
     .eq('user_id', userId)
     .eq('classroom_id', classroomId)
     .single()

2. Add joined_at filter to the messages query:
   .gte('created_at', membership.joined_at)

This ensures users only see messages from their join date onwards.

Log:
  debug: '[CORRIDOR:getMessages] join date filter'
    { userId, classroomId, joinedAt: membership.joined_at }

FRONTEND:

No frontend changes needed — the API already returns
paginated messages. The filter is applied server-side.

However add a visual indicator at the top of the message list
when a user first loads a classroom:

Show a system message pill at the very top of the list:
  "You joined this classroom on [formatted date]"
  Style: centered pill, muted gray background
  Same style as other system messages

This sets clear expectations — users understand why
they don't see earlier messages.

Run: npm run test
Commit: "feat: messages filtered from user join date,
join date system message in corridor"

---

## TASK 07 — Fix: classroom header UI [PENDING]

Three issues in the classroom header:

Read apps/web/app/classroom/[globalId]/page.tsx
Read alumini-demo.html screen s2 for exact reference.

FIX A — Header color:
The header is showing blue instead of dark navy.
Fix the gradient:
  background: linear-gradient(to bottom, #1c1c2e, #2d1b69)
NOT blue. Check where the blue color is coming from —
likely var(--color-primary) being applied incorrectly.

FIX B — Remove Details link, keep only + button:
Remove the "ⓘ Details" link from the header entirely.
Keep the "+" button in the tab bar (far right).
The "+" button shows a context panel based on current tab:
  Classroom tab → class info panel:
    Global ID (monospace, copyable)
    Created date
    Member count, teacher count, verified count
    Close button (X)
  Staff Room tab → teacher list panel
  Student Alley tab → student list panel
Panel appears as an overlay/drawer from the right side
or as a bottom sheet on mobile.
Close on: click outside, press Escape, click X

FIX C — Stats row: icons not text labels:
Replace text labels with icons + numbers:

Current: "1 member · 0 teachers · 1 verified · Batch of 2006"
Replace with icon rows matching the mockup exactly:

  👥 [memberCount]     (ti-users icon, 14px, white 70%)
  ·
  ✓ [verifiedCount]    (ti-check icon, 14px, white 70%)
  ·
  [batchYear]          (just the year — no "Batch of" prefix)

For batch year: show just "2006" not "Batch of 2006"
If current year - batchYear > 0: optionally show
"([N] years ago)" in very small muted text but only
if space allows — remove entirely if it looks cluttered.

Stats row: single line, white 60% opacity, 11px
Separator: " · " between each stat

Run: next build
Commit: "fix: classroom header — dark gradient, remove Details link,
icon stats row matching mockup"

---

## TASK 08 — Fix: message alignment before page reload [PENDING]

Own messages show on the LEFT side immediately after sending,
then move to the RIGHT after page reload. This is an optimistic
update bug — the sent message is added to the list without
the correct alignment flag.

Read apps/web/app/classroom/[globalId]/page.tsx
Find where a new message is added to the local state
after sending (optimistic update).

The message object added to state must include:
  sender_id: currentUserId (or is_own: true flag)
So the bubble renderer knows to align it right immediately.

Check the bubble renderer:
  If message.sender_id === currentUser.id → right align, primary color
  Else → left align, white bubble

Fix the optimistic update to include sender_id:
  const optimisticMessage = {
    id: `temp-${Date.now()}`,
    content: messageText,
    sender_id: currentUser.id,  ← must include this
    sender: { id: currentUser.id, full_name: currentUser.full_name },
    created_at: new Date().toISOString(),
    channel: currentChannel
  }

Run: next build
Commit: "fix: message alignment — optimistic update includes sender_id"
DO NOT PUSH YET — wait for all tasks to complete.

---

## TASK 09 — Feature: message attachments, events, polls via + button [PENDING]

Add a "+" button to the message input bar that opens
an action menu with four options:
  📎 Attach file (photos, documents)
  📅 Create event
  📊 Create poll
  (future: 📍 Location, 🎤 Voice note)

This is a significant feature — implement E2E carefully.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART A — Message input + button UI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/classroom/[globalId]/page.tsx
Find the message input bar at the bottom.

Add "+" button to the LEFT of the text input:
  28px circle, border 1px var(--color-border), white bg
  "+" icon (ti-plus, 16px, brand primary color)
  On click: toggle action menu above the input bar

Action menu (appears above input bar, slides up):
  White background, rounded top corners 14px
  border-top 1px var(--color-border)
  Padding 12px 16px
  Four action rows, each:
    Icon (28px circle, light purple bg) + Label (13px)
    Full row tappable

  Row 1: 📎 "Photo or file"
    On click: open file picker
    Accept: image/*, application/pdf, .doc, .docx, .xls, .xlsx
    Max size: 20MB
    Close menu after selecting

  Row 2: 📅 "Create event"
    On click: open event creation form (inline, not modal)
    Close menu

  Row 3: 📊 "Create poll"
    On click: open poll creation form (inline, not modal)
    Close menu

  Close menu on: tap outside, press Escape, tap "+" again

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART B — File attachments
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BACKEND:

Add endpoint: POST /corridor/:classroomId/:channel/upload
Auth: JwtAuthGuard, verified member of classroom
Accepts: multipart/form-data, field: 'file'
Max size: 20MB

Upload to Supabase Storage using SERVICE ROLE client:
  bucket: 'classroom-media' (create if missing)
  path: classrooms/[classroomId]/[channel]/[timestamp]-[filename]

Return:
{
  fileUrl: string,
  fileName: string,
  fileSize: number,
  fileType: string,  // 'image' | 'document'
  mimeType: string
}

Then send as a message with message_type = 'file':
POST /corridor/:classroomId/:channel/messages
Body: {
  content: fileName,
  message_type: 'file',
  metadata: { fileUrl, fileName, fileSize, mimeType, fileType }
}

Ensure messages table has message_type and metadata columns:
Create supabase/migrations/026_message_types.sql:

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS message_type text
  NOT NULL DEFAULT 'text'
  CHECK (message_type IN ('text', 'file', 'event', 'poll', 'system'));

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN public.messages.message_type IS
'text = regular message
 file = photo or document attachment
 event = classroom event card
 poll = poll card
 system = system notification (join, verify etc)';

FRONTEND:

After file selected:
  Show upload progress (inline in message area):
    File preview (image thumbnail or document icon)
    Progress bar
    File name + size
  On upload complete: send message with file metadata
  On error: show inline error, allow retry

Render file messages in the chat:
  Image files: show thumbnail (max 200px wide)
    Click → opens full size in lightbox
  Document files: show document card:
    File icon + name + size
    "Download" button
  Both: show sender name + time as normal

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART C — Poll feature (WhatsApp-style)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BACKEND:

Create supabase/migrations/027_polls.sql:

CREATE TABLE public.polls (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('classroom','staff_room','student_alley')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  question text NOT NULL CHECK (char_length(question) <= 500),
  options jsonb NOT NULL, -- array of { id, text, voteCount }
  allow_multiple boolean NOT NULL DEFAULT false,
  is_anonymous boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.poll_votes (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  option_ids jsonb NOT NULL, -- array of selected option IDs
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(poll_id, user_id)
);

ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "polls_read" ON public.polls;
CREATE POLICY "polls_read" ON public.polls FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.memberships m
  WHERE m.user_id = auth.uid()
  AND m.classroom_id = polls.classroom_id
  AND m.verification_status IN ('verified','pending_auto')
));

DROP POLICY IF EXISTS "polls_insert" ON public.polls;
CREATE POLICY "polls_insert" ON public.polls FOR INSERT
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "poll_votes_read" ON public.poll_votes;
CREATE POLICY "poll_votes_read" ON public.poll_votes FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "poll_votes_insert" ON public.poll_votes;
CREATE POLICY "poll_votes_insert" ON public.poll_votes FOR INSERT
WITH CHECK (user_id = auth.uid());

Add endpoints in a new polls module:

POST /polls/:classroomId/:channel
Auth: verified member
Body: {
  question: string,
  options: string[], -- array of option texts (min 2, max 10)
  allowMultiple: boolean,
  isAnonymous: boolean,
  expiresIn?: number -- hours, optional
}
Creates poll + sends a message with message_type='poll'
linking to the poll ID in metadata.

POST /polls/:pollId/vote
Auth: verified member
Body: { optionIds: string[] }
Validates: user hasn't voted, poll not expired,
if !allowMultiple then optionIds.length === 1
Updates poll options voteCount in jsonb
Creates poll_votes record
Returns: updated poll with vote counts

GET /polls/:pollId
Auth: verified member of that classroom
Returns: poll with options, vote counts, user's own vote

DELETE /polls/:pollId
Auth: poll creator or classroom admin
Marks poll as deleted (soft delete)

FRONTEND:

Poll creation form (inline, above message input):
  "Create a poll" heading
  Question input (textarea, max 500 chars, required)
  Options list:
    Start with 2 option inputs
    "Add option" link → adds another (max 10)
    "×" to remove an option (min 2 must remain)
    Each option: text input, placeholder "Option [N]"
  Toggles:
    "Allow multiple answers" (switch, default off)
    "Anonymous poll" (switch, default off)
  "Expires in" select: Never / 1 day / 3 days / 7 days
  "Create poll" button (primary)
  "Cancel" link (collapses form)

Poll message card in chat:
  White card with purple left border (3px)
  "📊 Poll" label (small, muted, top)
  Question (bold, 14px)
  Options list:
    Each option as a tappable row:
      If user hasn't voted: show option text + vote count (hidden if anonymous and not creator)
        Tap → cast vote immediately (optimistic)
      If user has voted: show filled progress bar
        Width = votePercentage%
        Background: brand primary light
        Text: option text + "N votes (X%)"
        Checkmark on user's chosen option(s)
  "N people voted" (muted, small, bottom)
  If expires_at: "Closes in [relative time]" (muted, small)
  If expired: "Poll closed" (muted, small)
  If creator or admin: "View all votes" link (if not anonymous)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART D — Visibility rules for late joiners
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Late joiners (joined after content was created) cannot see:
  - Messages (already implemented in TASK 06)
  - File attachments (filter by joined_at in messages query)
  - Polls (filter by joined_at — polls sent before join are hidden)
  - Past events (events with start_date before joined_at are hidden)

Late joiners CAN see:
  - Future events (start_date >= now()) regardless of when created
  - New messages from their join date onwards
  - New polls created after they joined

Implementation:
In corridor.service.ts getMessages():
  Already filters by joined_at (TASK 06)
  This covers messages, file attachments, and poll cards
  since they are all sent as messages

In events.service.ts getEvents():
  Return events where:
    (created_at >= membership.joined_at) -- created after user joined
    OR (start_date >= now()) -- future events regardless of creation date

Add this visibility note as a comment in the relevant
service files so future developers understand the intent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AFTER ALL PARTS COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: npm run test — all tests pass
Run: next build — 0 errors
DO NOT PUSH YET — wait for all tasks in this file to complete.
Mark this task [DONE] and move to next task.

IMPORTANT: After final push, run in Supabase SQL Editor IN ORDER:
  supabase/migrations/026_message_types.sql
  supabase/migrations/027_polls.sql
Also create 'classroom-media' bucket in Supabase Storage:
  Public: YES, Max size: 20MB

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

"Read TASKS_08.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
