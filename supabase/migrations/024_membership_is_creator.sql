-- TASKS_08 TASK 03 — classroom creators no longer get role forced to
-- 'admin' (see ClassroomService.createClassroom()'s doc comment); this
-- column tracks management rights independently of the channel-access
-- role field.
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).

ALTER TABLE public.memberships
ADD COLUMN IF NOT EXISTS is_creator boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.memberships.is_creator IS
'True for the user who created this classroom.
 Creator gets management rights regardless of their role.
 Channel access is still determined by the role field.';
