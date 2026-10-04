-- TASKS_09 TASK 27 — work anniversary feed card + daily notification.
--
-- work_company was NOT originally added here — TASKS_09 TASK 22 already
-- introduced profiles.company for the same purpose (self-reported
-- "current role"), and reusing it was meant to avoid a duplicate column.
-- TASKS_10 TASK 01 — that design call was overridden in production: both
-- `company` AND `work_company` were manually added as separate columns
-- on 2026-10-04 (see TASKS_10.md's CONTEXT section). This migration file
-- is only being updated to match what's actually live — no app code was
-- changed to use work_company instead of company; it exists on the table
-- but is currently unused by this codebase.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS work_start_date date;

-- TASKS_10 TASK 01 — profiles columns manually applied on 2026-10-04,
-- synced here to match production (fileUpdates.md UPDATE 10 already
-- covered job_title/company/location_city as a still-pending change;
-- this both applies that update and adds the newer columns from the same
-- manual session: location_lat/location_lng, work_company, bio, website).
-- birthday_month/birthday_day already have their own migration
-- (027_birthday_field.sql) and are not repeated here.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS company text,
ADD COLUMN IF NOT EXISTS job_title text,
ADD COLUMN IF NOT EXISTS location_city text,
ADD COLUMN IF NOT EXISTS location_lat numeric(9,6),
ADD COLUMN IF NOT EXISTS location_lng numeric(9,6),
ADD COLUMN IF NOT EXISTS work_company text,
ADD COLUMN IF NOT EXISTS bio text,
ADD COLUMN IF NOT EXISTS website text;
