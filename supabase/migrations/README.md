# Supabase Migrations

IMPORTANT: Migration files are NOT auto-applied.
Each must be run manually in Supabase SQL Editor.

## Status

Claude Code has no live Supabase/Postgres credentials in its working
environment (no `SUPABASE_ACCESS_TOKEN`, no direct DB connection string —
only the REST API keys in `apps/backend/.env`, which don't expose
`pg_tables`/`pg_policies`). The ⚠️ Check rows below were reviewed for
correctness (each is idempotent — safe to re-run even if already applied —
see the "Idempotency" column) but their actual presence in the live
database has NOT been verified against Supabase itself. Run the query in
"How to verify" and update this table from the real result before trusting
✅ Run below as current.

| File | Status | What it creates | Idempotent to re-run? |
|------|--------|-----------------|------------------------|
| 001_initial_schema.sql | ✅ Run | Core tables | No — plain `CREATE TABLE` |
| 002_auth_module.sql | ✅ Run | Auth tables | No |
| 003_institution_module.sql | ✅ Run | Institution tables | No |
| 004_verification_module.sql | ✅ Run | Verification tables | No |
| 005_codes_module.sql | ✅ Run | Institution codes | No |
| 006_notification_module.sql | ✅ Run | Notification tables | No |
| 007_premium_module.sql | ✅ Run | Premium features | No |
| 008_admin_module.sql | ✅ Run | Admin/institution-claim tables | No |
| 009_password_reset.sql | ✅ Run | Password reset tokens | No |
| 010_mfa_recovery.sql | ✅ Run | `mfa_recovery_tokens` table (note: TASK 06's checklist called this "mfa_recovery_codes" — no such table name exists anywhere in these migrations; `mfa_recovery_tokens` is the real one and is already ✅ here) | No |
| 011_pending_auto_status.sql | ⚠️ Check | Widens `memberships.verification_status` CHECK to add `pending_auto` | Yes — `DROP CONSTRAINT IF EXISTS` then re-add |
| 012_institution_requests.sql | ⚠️ Check | `institution_requests` table | No |
| 013_seed_institutions.sql | ⚠️ Check | 45 seeded institutions | Yes — `ON CONFLICT (slug) DO NOTHING` |
| 014_add_platform_admin.sql | ✅ Run | `is_platform_admin` column | — |
| 015_direct_messages.sql | ✅ Run | `direct_messages` table | No |
| 016_institution_logos.sql | ⚠️ Check | `institutions.logo_url`, `classrooms.cover_url` | Yes — `ADD COLUMN IF NOT EXISTS` |
| 017_linkedin_profile.sql | ⚠️ Check | `profiles.linkedin_connected/id/name/avatar_url` (scoped down — see migration's own comment) | Yes — `ADD COLUMN IF NOT EXISTS` |
| 018_email_otp_mfa.sql | ⚠️ Check | `mfa_method` CHECK widened to include `'email'`, `email_otp_codes` table | Partially — the CHECK-widening ALTERs are re-runnable, the `CREATE TABLE` is not |
| 020_session_token_hash.sql | ⚠️ Check | Defensive no-op — `sessions.user_agent/ip_address/last_used_at/revoked_at/revoked_reason` already exist as of 002_auth_module.sql; see the migration's own comment for why no new access-token-hash column was added | Yes — `ADD COLUMN IF NOT EXISTS` |

⚠️ Check = not verified against the live database from this environment —
run the query below and confirm before relying on this table.
✅ Run = confirmed by a prior session that had live DB access (see git
history for those sessions' notes) — not re-verified here.

Every migration file marked ⚠️ Check above uses `IF NOT EXISTS`/
`ON CONFLICT ... DO NOTHING`/`DROP CONSTRAINT IF EXISTS` guards (confirmed
by reading each file), except `012_institution_requests.sql`'s and
`018_email_otp_mfa.sql`'s `CREATE TABLE` statements — re-running those two
verbatim will error if the table already exists. Check with the query
below first, or wrap the `CREATE TABLE` in `CREATE TABLE IF NOT EXISTS`
before re-running.

## How to verify what's actually applied

Run in Supabase SQL Editor:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Cross-reference the result against the "What it creates" column above,
then update this table's Status column to match reality.

## How to run a migration

1. Open Supabase dashboard
2. Go to SQL Editor
3. Paste the contents of the migration file
4. Click Run
5. Update status in this file to ✅ Run
