-- TASKS_08 TASK 05 — channel-scoped event visibility, matching messages
-- (classroom/staff_room/student_alley — see MembershipService.canAccessChannel()).
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS channel text
  NOT NULL DEFAULT 'classroom'
  CHECK (channel IN ('classroom', 'staff_room', 'student_alley'));

COMMENT ON COLUMN public.events.channel IS
'Channel this event belongs to. Controls visibility:
 classroom = all verified members
 staff_room = teachers and admins only
 student_alley = students only';

-- RLS: replaces events_read/events_insert (001_initial_schema.sql) with
-- channel-aware versions, same pattern as messages_classroom_read /
-- messages_staff_room_read / messages_student_alley_read / messages_insert.

DROP POLICY IF EXISTS "events_read" ON public.events;
DROP POLICY IF EXISTS "events_insert" ON public.events;

-- CLASSROOM channel: all verified members
CREATE POLICY "events_classroom_read"
  ON public.events FOR SELECT
  USING (
    channel != 'classroom'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND m.verification_status = 'verified'
    )
  );

-- STAFF ROOM channel: verified teachers and admins only
CREATE POLICY "events_staff_room_read"
  ON public.events FOR SELECT
  USING (
    channel != 'staff_room'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND m.role IN ('teacher', 'admin')
        AND m.verification_status = 'verified'
    )
  );

-- STUDENT ALLEY channel: verified students only
CREATE POLICY "events_student_alley_read"
  ON public.events FOR SELECT
  USING (
    channel != 'student_alley'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND m.role = 'student'
        AND m.verification_status = 'verified'
    )
  );

-- INSERT: verified members only, in channels they have access to
CREATE POLICY "events_insert"
  ON public.events FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND m.verification_status = 'verified'
        AND (
          (channel = 'classroom')
          OR (channel = 'staff_room'    AND m.role IN ('teacher', 'admin'))
          OR (channel = 'student_alley' AND m.role = 'student')
        )
    )
  );
