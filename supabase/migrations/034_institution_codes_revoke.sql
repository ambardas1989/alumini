-- TASKS_11 TASK 06 — batch code revocation.
--
-- institution_codes already existed (001_initial_schema.sql) with
-- everything TASK 06 asked for except an explicit revoke flag — expiry
-- and redemption-exhaustion already made a code stop working, but there
-- was no way for an admin to kill a code early. Adding is_active to the
-- existing table rather than the new institution_codes table the task
-- described (see fileUpdates.md's note on this).
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.institution_codes
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.institution_codes.is_active IS
'False once an admin explicitly revokes the code (CodesService.revokeCode()) — independent of expires_at/redemption_count, both of which already stop a code working on their own.';
