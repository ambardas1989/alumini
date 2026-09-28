-- TASKS_09 TASK 23 — birthday collection for the home feed's birthday
-- cards + daily notification job.
--
-- PRIVACY — deliberate, not an oversight: only month and day are ever
-- collected, displayed, or stored. Birth YEAR is never asked for and has
-- no column here. This means age can never be derived from this data by
-- this app or anyone reading this table, which is the whole point —
-- "batchmates know it's your birthday today" doesn't require them (or
-- this app) to know how old you are.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS birthday_month integer
  CHECK (birthday_month BETWEEN 1 AND 12),
ADD COLUMN IF NOT EXISTS birthday_day integer
  CHECK (birthday_day BETWEEN 1 AND 31);

COMMENT ON COLUMN public.profiles.birthday_month IS
'Month only (1-12), no year — TASKS_09 TASK 23. Birth year is never collected or stored, by design.';

COMMENT ON COLUMN public.profiles.birthday_day IS
'Day only (1-31), no year — see birthday_month comment. Not cross-validated against birthday_month (e.g. Feb 31 is not rejected) — same tradeoff normal date pickers avoid by construction; this app''s own UI only offers valid day counts per month.';
