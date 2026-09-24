-- TASKS_06 TASK 08 — session security hardening.
--
-- Must be run manually in the Supabase SQL Editor — this repo's migrations
-- are not auto-applied on deploy (see supabase/migrations/README.md).
--
-- AUDIT FINDING: the task asked to confirm sessions has
-- id/user_id/token_hash/is_valid/expires_at/created_at, and to add
-- token_hash/device_info/ip_address/last_seen_at/is_valid if missing. On
-- inspection, 002_auth_module.sql's sessions table already has every one
-- of those, under names already used consistently throughout
-- auth.service.ts:
--   token_hash   → refresh_token_hash (SHA-256 hash of the refresh token —
--                  already exactly what the task describes, just scoped to
--                  the refresh token specifically, not the access token)
--   device_info  → user_agent (already populated by issueTokenPair())
--   ip_address   → already present (already populated by issueTokenPair())
--   last_seen_at → last_used_at (already present; now also updated on every
--                  authenticated request by AuthService.validateSession(),
--                  called from JwtStrategy)
--   is_valid     → revoked_at/revoked_reason (already used by logout(),
--                  logoutAllDevices(), revokeSession(), and
--                  enforceDeviceLimit() — a nullable timestamp carries
--                  strictly more information than a boolean: NULL = active,
--                  non-null = revoked AND when/why)
--
-- No new access-token hash column was added: every access token already
-- carries its own sessionId (see issueTokenPair()'s signToken() calls),
-- and sessions.id is already that session's unique, indexed primary key —
-- hashing and storing the access token itself for a second, redundant
-- lookup by hash would add complexity without adding any real capability.
-- JwtStrategy.validate() now looks up by sessionId directly (see
-- AuthService.validateSession()).
--
-- This migration is therefore a defensive no-op against the schema this
-- codebase's own migrations already produce — the IF NOT EXISTS guards
-- make it safe to run even so, in case some environment's `sessions` table
-- predates 002_auth_module.sql's current form.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS user_agent   text,
  ADD COLUMN IF NOT EXISTS ip_address   inet,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text;
