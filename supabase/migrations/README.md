# Supabase Migrations

IMPORTANT: Migration files are NOT auto-applied.
Each must be run manually in Supabase SQL Editor.

## Status

| File | Status | What it creates |
|------|--------|-----------------|
| 001_initial_schema.sql | ✅ Run | Core tables |
| 002_auth_module.sql | ✅ Run | Auth tables |
| 003_institution_module.sql | ✅ Run | Institution tables |
| 004_verification_module.sql | ✅ Run | Verification tables |
| 005_codes_module.sql | ✅ Run | Institution codes |
| 006_notification_module.sql | ✅ Run | Notification tables |
| 007_premium_module.sql | ✅ Run | Premium features |
| 008_admin_module.sql | ✅ Run | Admin/institution-claim tables |
| 009_password_reset.sql | ✅ Run | Password reset tokens |
| 010_mfa_recovery.sql | ✅ Run | MFA recovery codes |
| 011_pending_auto_status.sql | ⚠️ Check | pending_auto status |
| 012_institution_requests.sql | ⚠️ Check | Institution requests |
| 013_seed_institutions.sql | ⚠️ Check | 45 seeded institutions |
| 014_add_platform_admin.sql | ✅ Run | is_platform_admin column |
| 015_direct_messages.sql | ✅ Run | Direct messages table |

⚠️ Check = verify these were run in Supabase.
Run any that are missing before testing related features.

## How to run a migration

1. Open Supabase dashboard
2. Go to SQL Editor
3. Paste the contents of the migration file
4. Click Run
5. Update status in this file to ✅ Run
