-- ============================================================
-- Alumini — Verification Module Tables
-- Migration: 004_verification_module.sql
--
-- Fixes Security issue #1 from the original scaffold review: the
-- placeholder `const isValid = true;` in VerificationService.confirmEmailOtp()
-- accepted ANY code for ANY user. This table gives Method 1 (institutional
-- email OTP) real, hashed, expiring, attempt-limited storage — the same
-- shape as the auth module's mfa_sms_challenges (002_auth_module.sql),
-- because it's solving the identical problem (a short-lived numeric code
-- that must never be stored or compared in plaintext).
--
-- `verifications`, `institution_codes`, and `memberships` already exist
-- (001_initial_schema.sql) and are read/written directly by
-- apps/backend/src/modules/verification — the same established
-- cross-module table-access pattern used by every module since auth.
-- ============================================================

CREATE TABLE public.verification_email_otps (
  id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  classroom_id         uuid        NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  institutional_email  text        NOT NULL,
  code_hash            text        NOT NULL,   -- SHA-256 hash — the raw code is never stored
  attempts             integer     NOT NULL DEFAULT 0,
  consumed             boolean     NOT NULL DEFAULT false,
  expires_at           timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.verification_email_otps IS
  'Institutional-email OTP challenges for verification Method 1
   (SPEC.md §8.1). One row per POST /verify/email call — a new request
   invalidates any still-outstanding OTP for the same (user_id, classroom_id)
   (see VerificationService.initiateEmailVerification()). consumed=true
   once either the correct code is entered OR appConfig.EMAIL_OTP_MAX_ATTEMPTS
   incorrect attempts have been made (brute-force protection) OR it expired
   (appConfig.EMAIL_OTP_EXPIRY_MINUTES) and was read past that point.
   Service-role access only — no client ever reads this table directly.';

CREATE INDEX verification_email_otps_lookup_idx
  ON public.verification_email_otps(user_id, classroom_id, consumed, expires_at);

ALTER TABLE public.verification_email_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "verification_email_otps_no_direct_access"
  ON public.verification_email_otps FOR SELECT
  USING (false);

CREATE POLICY "verification_email_otps_no_insert"
  ON public.verification_email_otps FOR INSERT
  WITH CHECK (false);
