-- TASKS_05 TASK 08 — Email OTP as default MFA, TOTP as enhanced option.
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).
--
-- IMPORTANT: profiles.mfa_method already exists (001_initial_schema.sql)
-- with CHECK (mfa_method IN ('totp','sms')) and NO default. A plain
-- "ADD COLUMN IF NOT EXISTS ... DEFAULT 'email'" (the task's original
-- literal text) would be a no-op — the column is already there — and the
-- existing CHECK constraint would still reject 'email'. This drops and
-- re-adds that constraint instead, keeping 'sms' (still used by
-- appConfig.FEATURE_SMS_MFA) alongside the new 'email' value.

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_mfa_method_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_mfa_method_check CHECK (mfa_method IN ('email', 'totp', 'sms'));

ALTER TABLE public.profiles
ALTER COLUMN mfa_method SET DEFAULT 'email';

-- Existing accounts that finished MFA setup already have mfa_method set by
-- completeMfaSetup() — this only backfills any row that somehow doesn't
-- (never overwrites an already-set 'sms'/'totp').
UPDATE public.profiles
SET mfa_method = 'totp'
WHERE mfa_enabled = true AND mfa_method IS NULL;

CREATE TABLE IF NOT EXISTS public.email_otp_codes (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('login', 'password_reset', 'mfa_change')),
  attempts     int NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  used         boolean NOT NULL DEFAULT false,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_otp_user_purpose_idx
  ON public.email_otp_codes(user_id, purpose, expires_at);

ALTER TABLE public.email_otp_codes ENABLE ROW LEVEL SECURITY;

-- Service role only — explicit deny-all policies, matching the exact
-- pattern every other OTP/token table in this codebase uses
-- (mfa_sms_challenges, mfa_totp_secrets, password_reset_tokens,
-- mfa_recovery_tokens — see 002_auth_module.sql / 009_password_reset.sql /
-- 010_mfa_recovery.sql). AuthService.sendEmailOtp()/checkEmailOtp() always
-- go through the service-role client, which bypasses RLS regardless —
-- these policies exist to make the "no client-direct access" intent
-- explicit rather than relying on the implicit deny that zero policies
-- already produces, and to guard against ever adding a client-facing
-- Supabase call against this table by accident later.
--
-- NOT adding auth.uid()-owner policies here (an earlier task briefly asked
-- for CREATE POLICY ... WITH CHECK (auth.uid() = user_id) on this table):
-- that would let any authenticated client INSERT/SELECT/UPDATE its own
-- email_otp_codes rows directly via the anon-key Supabase client, bypassing
-- AuthService's rate limiting (MFA_EMAIL_OTP_RATE_LIMIT_PER_10MIN), hashing,
-- and attempt-capping entirely — a client could mint or read back its own
-- OTP challenge rows. Deliberately declined as a regression, not applied.
CREATE POLICY "email_otp_codes_no_direct_access"
  ON public.email_otp_codes FOR SELECT
  USING (false);

CREATE POLICY "email_otp_codes_no_insert"
  ON public.email_otp_codes FOR INSERT
  WITH CHECK (false);
