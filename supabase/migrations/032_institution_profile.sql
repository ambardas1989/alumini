-- TASKS_11 TASK 03 — institution profile/branding settings.
--
-- cover_photo_url is new (distinct from the existing classrooms.cover_url
-- and institutions.logo_url, both from 016_institution_logos.sql) — an
-- institution-level banner image, not a classroom's.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.institutions
ADD COLUMN IF NOT EXISTS cover_photo_url text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS website text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS founded_year integer,
ADD COLUMN IF NOT EXISTS board text,
ADD COLUMN IF NOT EXISTS medium text;

COMMENT ON COLUMN public.institutions.cover_photo_url IS
'Public Storage URL — bucket institution-assets, path institutions/[institutionId]/cover.[ext].
 Set via POST /institution/:id/cover-photo (platform admin or an active institution admin).';
