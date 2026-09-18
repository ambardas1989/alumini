-- ============================================================
-- Alumini — Institution Module Tables
-- Migration: 003_institution_module.sql
--
-- institutions and personas already exist (001_initial_schema.sql) and are
-- read/written directly by apps/backend/src/modules/institution — the same
-- cross-module table-access pattern already established by the auth module
-- (which reads/writes profiles and personas) and the identity module
-- (which owns personas' day-to-day CRUD). See InstitutionService's
-- module-level comment for the full reasoning.
--
-- This migration adds the one table institution TRULY introduces:
--   institution_admin_invites — tracks outstanding co-admin invitations
--   (SPEC.md §11.3). The actual "magic link" credential is a signed JWT
--   (via the auth module's JwtService, purpose='admin_invite',
--   appConfig.ADMIN_INVITE_EXPIRY_HOURS) — this row exists so
--   GET /institution/:id/admins can list pending invites, and so
--   acceptance/expiry can be checked server-side without needing to decode
--   every outstanding token.
-- ============================================================

CREATE TABLE public.institution_admin_invites (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id uuid        NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  email          text        NOT NULL,
  invited_by     uuid        NOT NULL REFERENCES public.profiles(id),
  expires_at     timestamptz NOT NULL,
  accepted_at    timestamptz,
  accepted_by    uuid        REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.institution_admin_invites IS
  'One row per co-admin invitation (SPEC.md §11.3). An invite counts against
   appConfig.INSTITUTION_MAX_ADMINS alongside active/pending_approval
   personas while outstanding (accepted_at IS NULL AND expires_at > now())
   — see InstitutionService.assertAdminCapNotReached(). accepted_by is set
   on acceptance for audit correlation even though it will always equal the
   profile matched by `email` at that time.';

CREATE INDEX institution_admin_invites_institution_idx
  ON public.institution_admin_invites(institution_id, accepted_at, expires_at);

ALTER TABLE public.institution_admin_invites ENABLE ROW LEVEL SECURITY;

-- No direct client access — same pattern as institution_codes in
-- 001_initial_schema.sql. All reads (the admin roster's "pending invites"
-- list) and writes (create on invite, mark accepted) go through the API's
-- service-role client only.
CREATE POLICY "institution_admin_invites_no_direct_access"
  ON public.institution_admin_invites FOR SELECT
  USING (false);

CREATE POLICY "institution_admin_invites_no_insert"
  ON public.institution_admin_invites FOR INSERT
  WITH CHECK (false);
