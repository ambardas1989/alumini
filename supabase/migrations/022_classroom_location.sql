-- TASKS_07 TASK 08 FIX B — city/state/country on classrooms.
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).
--
-- Editable independent of the selected institution's own city_code: an
-- institution can have branches/campuses in more than one city, so the
-- classroom's own location isn't always the institution's default (see
-- ClassroomCreateForm.tsx's own comment on why these are pre-filled but
-- editable, not derived).

ALTER TABLE public.classrooms
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS state text,
ADD COLUMN IF NOT EXISTS country_code text DEFAULT 'IN';
