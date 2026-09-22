-- TASKS_05 TASK 05 — institution logos + classroom cover photos.
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).

ALTER TABLE public.institutions
ADD COLUMN IF NOT EXISTS logo_url text;

ALTER TABLE public.classrooms
ADD COLUMN IF NOT EXISTS cover_url text;

COMMENT ON COLUMN public.institutions.logo_url IS
'Public Storage URL — bucket institution-assets, path institutions/[institutionId]/logo.[ext].
 Set via POST /institution/:id/logo (platform admin or an active institution admin).';

COMMENT ON COLUMN public.classrooms.cover_url IS
'Public Storage URL — bucket institution-assets, path classrooms/[classroomId]/cover.[ext].
 Set via POST /classroom/:id/cover (verified classroom admin only).';
