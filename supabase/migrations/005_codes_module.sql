-- ============================================================
-- Alumini — Codes Module: lazy-expiry tracking column
-- Migration: 005_codes_module.sql
--
-- institution_codes itself already exists (001_initial_schema.sql) and is
-- read/written directly by apps/backend/src/modules/codes — the same
-- established cross-module table-access pattern every module since auth
-- has used.
--
-- This migration adds the one column codes genuinely needs that wasn't
-- already there: a marker for "have we already logged the
-- CODE_EXPIRED audit event for this code". The task requires lazy expiry
-- — "Write audit log: AuditEventType.CODE_EXPIRED when a code is found
-- expired (lazy expiry — log on first expired access)" — which needs
-- somewhere to record that the first observation already happened, or
-- every subsequent GET /codes/:classroomId call would re-log the same
-- expiry event.
-- ============================================================

ALTER TABLE public.institution_codes
  ADD COLUMN expiry_logged_at timestamptz;

COMMENT ON COLUMN public.institution_codes.expiry_logged_at IS
  'Set the first time this code is observed past expires_at, by the
   lazy-expiry check in CodesService.listCodes(). NULL means either the
   code has not expired yet, or it has but no one has looked at it since.
   Prevents re-emitting AuditEventType.CODE_EXPIRED on every subsequent
   listing of an already-logged expired code.';
