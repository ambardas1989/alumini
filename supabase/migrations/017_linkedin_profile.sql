-- TASKS_05 TASK 06 — LinkedIn connect (profile enrichment), SCOPED DOWN.
--
-- The task's original spec listed linkedin_headline, linkedin_company,
-- linkedin_location, linkedin_education, and linkedin_synced_at columns.
-- Those are deliberately NOT added here: LinkedIn's standard consumer OAuth
-- (what any registered app can request without a business partnership
-- review) only ever returns a person's id, name, and profile photo — never
-- job history, education, headline, or location. Adding columns this app
-- can never legitimately populate would just be dead schema inviting a
-- future fabricated-data bug. See auth.service.ts's connectLinkedin() doc
-- comment for the full reasoning.
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS linkedin_connected boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS linkedin_id text,
ADD COLUMN IF NOT EXISTS linkedin_name text,
ADD COLUMN IF NOT EXISTS linkedin_avatar_url text;

COMMENT ON COLUMN public.profiles.linkedin_connected IS
'Whether this account has connected LinkedIn via OAuth (TASKS_05 TASK 06).
 Distinct from linkedin_verified/linkedin_url, which belong to the
 classroom-verification LinkedIn method (app/verify/LinkedInMethod.tsx) —
 a different, unrelated feature.';
