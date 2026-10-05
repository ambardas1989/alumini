# AlumTribe — Pending File Updates

These are small code/migration fixes that were applied
directly in Supabase or identified but not yet committed
to the repo. Apply these in the next available Claude Code
session before running new task files.

---

## UPDATE 01 — email_otp_codes INSERT policy fix

File: supabase/migrations/018_email_otp_mfa.sql

Problem: INSERT policy uses auth.uid() = user_id which
fails when backend uses service role key (auth.uid() is null).

Find this policy in the migration file:
CREATE POLICY "email_otp_service_insert"
ON public.email_otp_codes FOR INSERT
WITH CHECK (auth.uid() = user_id);

Replace with:
CREATE POLICY "email_otp_service_insert"
ON public.email_otp_codes FOR INSERT
WITH CHECK (true);

Already applied manually in Supabase SQL Editor:
DROP POLICY IF EXISTS "email_otp_service_insert" ON public.email_otp_codes;
CREATE POLICY "email_otp_service_insert"
ON public.email_otp_codes FOR INSERT
WITH CHECK (true);

Action: update the migration file to match production.

---

## UPDATE 02 — memberships verification_method constraint

File: supabase/migrations/023_membership_constraints.sql

Problem: 'early_member' was not in the allowed values.
Already applied manually in Supabase SQL Editor.

Ensure migration file contains:
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

---

## UPDATE 03 — profiles mfa_method constraint fix

File: supabase/migrations/018_email_otp_mfa.sql

Problem: constraint did not include all valid values.
Already applied manually in Supabase SQL Editor.

Ensure migration file contains:
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_mfa_method_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_mfa_method_check
CHECK (mfa_method IN ('email', 'totp'));

---

## UPDATE 04 — Storage policies migration

File: supabase/migrations/021_storage_policies.sql

Already applied manually in Supabase SQL Editor.
Migration file needs to be created with DROP IF EXISTS
before each CREATE POLICY.
See TASKS_07 TASK 03 for full SQL.

---

## UPDATE 05 — linkedin_name and linkedin_avatar_url columns

File: supabase/migrations/017_linkedin_profile.sql

Already applied manually in Supabase SQL Editor:
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS linkedin_name text;
ADD COLUMN IF NOT EXISTS linkedin_avatar_url text;

Ensure migration file includes these columns.

---

## UPDATE 06 — email_otp_codes attempts column

File: supabase/migrations/018_email_otp_mfa.sql

Already applied manually in Supabase SQL Editor:
ALTER TABLE public.email_otp_codes
ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

Ensure migration file includes this column.

---

## UPDATE 07 — sessions table INSERT policy fix

File: whichever migration creates the sessions table RLS policies

Problem: sessions INSERT policy uses auth.uid() = user_id
which fails when backend uses service role key.

Already applied manually in Supabase SQL Editor:
DROP POLICY IF EXISTS "sessions_insert" ON public.sessions;
CREATE POLICY "sessions_insert"
ON public.sessions FOR INSERT
WITH CHECK (true);

Also check SELECT and UPDATE policies on sessions table —
if they use auth.uid() for backend operations, fix those too:
DROP POLICY IF EXISTS "sessions_select" ON public.sessions;
CREATE POLICY "sessions_select"
ON public.sessions FOR SELECT
USING (true);

DROP POLICY IF EXISTS "sessions_update" ON public.sessions;
CREATE POLICY "sessions_update"
ON public.sessions FOR UPDATE
USING (true);

Action: update migration file to use WITH CHECK (true)
for all sessions policies that the backend writes to.

---

## UPDATE 08 — membership fetch using globalId instead of UUID

File: apps/backend/src/modules/membership/membership.service.ts

Problem: GET /membership/:classroomId is receiving the
globalId (e.g. IN-KOL-KVFORTW-10C-2006) but querying
memberships table with it as if it were a UUID.

Fix in membership.service.ts getByClassroom() or getMembership():
  First look up the classroom UUID from globalId:
  const { data: classroom } = await supabaseAdmin
    .from('classrooms')
    .select('id')
    .eq('global_id', classroomId)
    .single()

  Then use classroom.id (UUID) for the membership query:
  .eq('classroom_id', classroom.id)

Also check membership.controller.ts — the route param
may need to be renamed from :classroomId to :globalId
to make the intent clear.

Same fix needed anywhere else that passes globalId
to a query expecting a UUID classroom_id.

---

## UPDATE 09 — Events channel visibility rules correction

File: apps/backend/src/modules/events/events.service.ts
File: supabase/migrations/025_events_channel.sql (if created)

Correct the events visibility rules — admins and teachers
should NOT see student_alley events. Student Alley is
always private from teachers and admins.

Correct rules:
  Student → classroom channel + student_alley channel events
  Teacher → classroom channel + staff_room channel events
  Admin   → classroom channel + staff_room channel events

Wrong rule (do not implement):
  Admin/Teacher → all channels (was incorrectly specified earlier)

Apply this rule in:
1. events.service.ts getEvents() — filter by allowed channels per role
2. ClassroomCard component — upcoming events count per role
3. Classroom events tab — show only role-appropriate events

---

## UPDATE 10 — profiles current-role columns (TASKS_09 TASK 22)

File: supabase/migrations/030_work_anniversary.sql

RESOLVED (TASKS_10 TASK 01, 2026-10-04) — job_title/company/location_city
were manually applied directly in Supabase SQL Editor on 2026-10-04 (see
UPDATE 11 below for the full list applied in that same session) and the
migration file has been updated to match. No longer a pending action.

---

## UPDATE 11 — additional profile fields + message_type 'poll' (TASKS_10 TASK 01)

Files: supabase/migrations/030_work_anniversary.sql,
       supabase/migrations/029_message_visiting_city_type.sql

Already applied manually in Supabase SQL Editor on 2026-10-04:

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS company text,
ADD COLUMN IF NOT EXISTS job_title text,
ADD COLUMN IF NOT EXISTS location_city text,
ADD COLUMN IF NOT EXISTS location_lat numeric(9,6),
ADD COLUMN IF NOT EXISTS location_lng numeric(9,6),
ADD COLUMN IF NOT EXISTS work_company text,
ADD COLUMN IF NOT EXISTS bio text,
ADD COLUMN IF NOT EXISTS website text;

ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE public.messages
ADD CONSTRAINT messages_message_type_check
CHECK (message_type IN ('text', 'event_card', 'system', 'attachment', 'announcement', 'visiting_city', 'poll'));

Action: migration files updated to match production. No app code reads
or writes location_lat/location_lng, work_company, bio, website, or the
'poll' message type yet — those columns/value exist on the live
database ahead of any feature using them, not because a feature needs
them right now.

---

## UPDATE 12 — Staff Room RLS audit (TASKS_10 TASK 02)

No file change needed. Audited `supabase/migrations/001_initial_schema.sql`'s
`messages_staff_room_read`/`messages_insert` policies and
`011_pending_auto_status.sql`'s override of `messages_insert`: both already
restrict staff_room to `role IN ('teacher', 'admin')` with
`verification_status = 'verified'`, with no exception for `is_creator` or
any other condition. `messages_student_alley_read`/the student_alley branch
of `messages_insert` are likewise already role-locked to `'student'`. Also
confirmed `ClassroomService.createClassroom()` already assigns the creator's
`role` from their own persona (TASKS_08 TASK 03), not a hardcoded `'admin'`,
so a student who creates a classroom does not get staff_room access that
way either. Recorded here only so a future session doesn't re-open this
investigation from scratch.

---

## UPDATE 13 — personas.requested_role/requested_message (TASKS_11 TASK 01)

File: supabase/migrations/031_institution_admin_requests.sql

Not yet applied in Supabase. Run manually:

ALTER TABLE public.personas
ADD COLUMN IF NOT EXISTS requested_role text,
ADD COLUMN IF NOT EXISTS requested_message text;

Action: TASKS_11 TASK 01 originally asked for a new `institution_admins`
table — adapted per explicit product direction to extend the existing
personas (type='school_admin') + institution_admin_invites claim/invite
system instead (see the migration file's own comment for why). These two
nullable columns are the only schema change actually needed: a structured
place for the "role at the institution" + optional message a
request-access submission carries, for the platform-admin review UI.

---

## UPDATE 14 — institutions profile/branding columns (TASKS_11 TASK 03)

File: supabase/migrations/032_institution_profile.sql

Not yet applied in Supabase. Run manually:

ALTER TABLE public.institutions
ADD COLUMN IF NOT EXISTS cover_photo_url text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS website text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS founded_year integer,
ADD COLUMN IF NOT EXISTS board text,
ADD COLUMN IF NOT EXISTS medium text;

---

## UPDATE 15 — institution_subscriptions table (TASKS_11 TASK 04)

File: supabase/migrations/033_institution_subscriptions.sql

Not yet applied in Supabase. Run manually — full CREATE TABLE in that
file, one row per institution, created lazily on first PATCH (not
pre-seeded for every institution).

Post-TASK-11 correction: max_classrooms/max_members_per_classroom now
default to NULL (were 5/100) — InstitutionService.getSubscription()'s own
application-level DEFAULT_SUBSCRIPTION fallback is the sole source of
truth for those defaults when no row exists; the DB no longer also
defines them. RLS enabled (service-role backend calls bypass it as usual;
this is defense-in-depth for any future direct client access) — admin
access via an active school_admin persona for that institution OR a
platform admin.

---

## UPDATE 16 — institution_codes.is_active (TASKS_11 TASK 06)

File: supabase/migrations/034_institution_codes_revoke.sql

Not yet applied in Supabase. Run manually:

ALTER TABLE public.institution_codes
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

Action: TASKS_11 TASK 06 asked for a new institution_codes table, but one
already existed (001_initial_schema.sql) covering everything the task
needed except an explicit revoke flag — added that one column instead of
duplicating the table.

---

## UPDATE 17 — classrooms.archived_at (TASKS_11 TASK 07)

File: supabase/migrations/035_classroom_archive.sql

Not yet applied in Supabase. Run manually:

ALTER TABLE public.classrooms
ADD COLUMN IF NOT EXISTS archived_at timestamptz;

---

## UPDATE 18 — institution_announcements table (TASKS_11 TASK 08)

File: supabase/migrations/036_institution_announcements.sql

Not yet applied in Supabase. Run manually — full CREATE TABLE in that
file.

Post-TASK-11 correction: added an index on institution_id (every query
InstitutionService.listAnnouncements()/sendAnnouncement() runs filters by
it) and enabled RLS — admin access via an active school_admin persona for
that institution OR a platform admin, same policy shape as UPDATE 15.

---

## HOW TO APPLY

When tokens are available, paste this into Claude Code:

"Read fileUpdates.md in the project root.
Apply each update to the corresponding file in the repo.
Do not run any migrations — just update the files.
After all updates are applied commit with message:
'chore: sync migration files with manual Supabase changes'
Push."
