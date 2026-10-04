-- TASKS_11 TASK 07 — institution admin classroom archive.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.classrooms
ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.classrooms.archived_at IS
'Set by an institution admin (InstitutionService.archiveClassroom()). Archived classrooms are read-only — CorridorService.sendMessage() rejects new posts while this is set. Members keep read access and existing membership.';
