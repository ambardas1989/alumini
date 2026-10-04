-- TASKS_11 TASK 01 — institution admin "request access" flow.
--
-- ADAPTED FROM TASKS_11's literal spec: the task asked for a brand-new
-- institution_admins table with its own status/invite state machine, but
-- this codebase already has a fully-built, tested equivalent —
-- InstitutionService's personas (type='school_admin') + claim/invite flow
-- (institution.service.ts's own header comment, SPEC.md §11). Building a
-- second parallel "institution admin" table would mean two different
-- sources of truth for the same concept. Per explicit product direction,
-- TASK 01 extends the existing personas-based flow instead — this
-- migration only adds the two columns personas was missing to support a
-- free-text "role at the institution" + message on a pending request,
-- which submitClaim()'s existing `justification`-in-audit-log pattern
-- didn't give the platform-admin review UI a structured field to show.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.personas
ADD COLUMN IF NOT EXISTS requested_role text,
ADD COLUMN IF NOT EXISTS requested_message text;

COMMENT ON COLUMN public.personas.requested_role IS
  'Self-reported role at the institution (principal/vice_principal/admin_staff/teacher) for a school_admin persona created via the request-access flow. Null for personas created via claim/invite.';
COMMENT ON COLUMN public.personas.requested_message IS
  'Optional free-text note submitted with a school_admin access request, shown to the platform admin reviewing it.';
