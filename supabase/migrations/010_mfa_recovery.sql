-- ============================================================
-- Alumini — MFA Recovery Tokens
-- Migration: 010_mfa_recovery.sql
--
-- Table owned by apps/backend/src/modules/auth (same "each module owns
-- its tables" convention as 002_auth_module.sql and 009_password_reset.sql
-- — this one was specified as 007 in the task that requested it, but 007
-- was already taken by 007_premium_module.sql).
--
--   mfa_recovery_tokens — one row per POST /auth/mfa/recovery-request.
--   Mirrors password_reset_tokens' own shape and reasoning exactly: only
--   the SHA-256 hash of the raw emailed token is ever stored.
-- ============================================================

CREATE TABLE public.mfa_recovery_tokens (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used       boolean     NOT NULL DEFAULT false,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mfa_recovery_tokens IS
  'One row per POST /auth/mfa/recovery-request request. A token is usable
   when used = false AND expires_at > now(). Recovery links are valid for
   1 hour (appConfig.MFA_RECOVERY_TOKEN_EXPIRY_MINUTES). Verifying a token
   (POST /auth/mfa/recovery-verify) clears the account''s MFA enrolment
   entirely — mfa_totp_secrets row deleted, profiles.mfa_enabled reset to
   false — and issues a fresh mfa_setup pending token so the user re-
   enrols immediately. Service-role access only, mirroring
   password_reset_tokens.';
COMMENT ON COLUMN public.mfa_recovery_tokens.token_hash IS
  'SHA-256 hex digest of the raw token embedded in the emailed recovery
   link. A database read alone can never be used to bypass MFA.';

CREATE INDEX mfa_recovery_tokens_hash_idx
  ON public.mfa_recovery_tokens(token_hash);

ALTER TABLE public.mfa_recovery_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mfa_recovery_tokens_no_direct_access"
  ON public.mfa_recovery_tokens FOR SELECT
  USING (false);

CREATE POLICY "mfa_recovery_tokens_no_insert"
  ON public.mfa_recovery_tokens FOR INSERT
  WITH CHECK (false);
