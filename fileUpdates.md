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

## HOW TO APPLY

When tokens are available, paste this into Claude Code:

"Read fileUpdates.md in the project root.
Apply each update to the corresponding file in the repo.
Do not run any migrations — just update the files.
After all updates are applied commit with message:
'chore: sync migration files with manual Supabase changes'
Push."
