-- TASKS_08 TASK 02 — memberships.verification_method CHECK constraint was
-- missing 'early_member', so joining a classroom failed with
-- "new row violates check constraint memberships_verification_method_check".
-- Already applied manually in the Supabase SQL Editor; this file just
-- records it in version control.
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).

ALTER TABLE public.memberships
DROP CONSTRAINT IF EXISTS memberships_verification_method_check;

ALTER TABLE public.memberships
ADD CONSTRAINT memberships_verification_method_check
CHECK (verification_method IN (
  'creator',
  'early_member',
  'email_domain',
  'peer_vouch',
  'document',
  'linkedin',
  'institution_code',
  'admin'
));
