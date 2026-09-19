-- ============================================================
-- Alumini — Password Reset Tokens
-- Migration: 009_password_reset.sql
--
-- Table owned by apps/backend/src/modules/auth
-- (see 002_auth_module.sql's own header for the "each module owns its
-- tables" convention this follows).
--
--   password_reset_tokens — one row per forgot-password request. The raw
--   token only ever exists in the reset-link email; only its SHA-256 hash
--   is stored, mirroring sessions.refresh_token_hash's same reasoning.
-- ============================================================

CREATE TABLE public.password_reset_tokens (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used       boolean     NOT NULL DEFAULT false,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.password_reset_tokens IS
  'One row per POST /auth/forgot-password request. A token is usable when
   used = false AND expires_at > now(). Reset links are valid for 1 hour
   (see AuthService.forgotPassword()). Service-role access only — no
   client ever reads this table directly, mirroring mfa_totp_secrets.';
COMMENT ON COLUMN public.password_reset_tokens.token_hash IS
  'SHA-256 hex digest of the raw token embedded in the emailed reset link.
   A database read alone can never be used to reset a password.';

CREATE INDEX password_reset_tokens_hash_idx
  ON public.password_reset_tokens(token_hash);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write (no user-facing RLS needed)
CREATE POLICY "password_reset_tokens_no_direct_access"
  ON public.password_reset_tokens FOR SELECT
  USING (false);

CREATE POLICY "password_reset_tokens_no_insert"
  ON public.password_reset_tokens FOR INSERT
  WITH CHECK (false);
