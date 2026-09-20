-- TASK 01 (TASKS_03.md) — profiles.is_platform_admin, idempotent
--
-- The column already exists in 008_admin_module.sql's plain (non-IF-NOT-
-- EXISTS) ADD COLUMN — this migration doesn't duplicate that column, it
-- makes the same statement safe to (re-)run against an environment whose
-- live database drifted from migration history (e.g. the column was added
-- by hand via the Supabase dashboard before 008 was ever applied there).

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_platform_admin IS
'True only for AlumTribe internal ops team.
 Set manually via Supabase dashboard — never by users.
 Never expose this field in public API responses.';
