-- TASKS_09 TASK 08 — the events_*_read policies (025_events_channel.sql)
-- required verification_status = 'verified' to see ANY event, which is
-- stricter than the backend's own rule (EventsService.canSeeEvent()):
-- future events are visible to every member regardless of verification
-- status; only PAST events stay verified-only, and only ones created on or
-- after the member's own joined_at. The backend always queries via the
-- service-role client (bypasses RLS), so this drift never blocked the API
-- fix itself, but it's still wrong for anyone who ever reads `events`
-- directly as an authenticated Supabase client — bringing it in line here.
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).
-- Depends on 025_events_channel.sql (events.channel column + policies).

DROP POLICY IF EXISTS "events_classroom_read" ON public.events;
DROP POLICY IF EXISTS "events_staff_room_read" ON public.events;
DROP POLICY IF EXISTS "events_student_alley_read" ON public.events;

-- CLASSROOM channel: any member sees future events; verified members also
-- see past events created on or after they joined.
CREATE POLICY "events_classroom_read"
  ON public.events FOR SELECT
  USING (
    channel != 'classroom'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND (
          events.event_date >= now()
          OR (m.verification_status = 'verified' AND events.created_at >= m.joined_at)
        )
    )
  );

-- STAFF ROOM channel: teachers/admins only, same future/past split.
CREATE POLICY "events_staff_room_read"
  ON public.events FOR SELECT
  USING (
    channel != 'staff_room'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND m.role IN ('teacher', 'admin')
        AND (
          events.event_date >= now()
          OR (m.verification_status = 'verified' AND events.created_at >= m.joined_at)
        )
    )
  );

-- STUDENT ALLEY channel: students only, same future/past split.
CREATE POLICY "events_student_alley_read"
  ON public.events FOR SELECT
  USING (
    channel != 'student_alley'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND m.role = 'student'
        AND (
          events.event_date >= now()
          OR (m.verification_status = 'verified' AND events.created_at >= m.joined_at)
        )
    )
  );
