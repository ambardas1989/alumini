-- TASKS_09 TASK 27 — work anniversary feed card + daily notification.
--
-- work_company is NOT added here — TASKS_09 TASK 22 already introduced
-- profiles.company for the same purpose (self-reported "current role");
-- reusing it avoids a duplicate column. Only work_start_date is new.
-- Day-of-month is intentionally stored (not just month/year) — the task
-- wants "March 2019" stored as 2019-03-01, so the day is always 1 and
-- never actually used for the anniversary-date match (see
-- NotificationService.sendWorkAnniversaryNotifications(), which compares
-- month only alongside a "year < current year" check, not day).
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS work_start_date date;
