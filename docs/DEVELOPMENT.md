# Development Notes

## Testing channel access

Classroom creator = always admin. To test correctly:
1. Create classroom with account A (becomes admin)
2. Join with account B as student
3. Test Staff Room — account B sees restriction message
4. Test Student Alley — account B has full access

Test accounts:
- textambar@gmail.com — platform admin
- testuser1@yopmail.com — admin of KV Fort William
- testuser2@yopmail.com — create this for student testing

## Browser testing

If API calls show "provisional headers" and get cancelled:
- Browser extension is blocking the request
- Test in Incognito (Ctrl+Shift+N) — disables extensions
- Common culprits: uBlock Origin, Privacy Badger, ad blockers
- Always use Incognito for production testing

## Running Supabase migrations

Migration files in supabase/migrations/ must be run
manually in Supabase SQL Editor.
They are NOT auto-applied.
Check supabase/migrations/README.md for status of each.

## Before deploying a new feature

1. Check if any new migration files were added
2. Run them in Supabase SQL Editor IN ORDER
3. Verify the table exists before testing the feature
4. Update supabase/migrations/README.md status

This prevents PGRST205 "table not found" errors in production.

## RLS policy rule

Every new table MUST have RLS policies defined in its migration file —
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` alone (no policies) already
denies all non-service-role access by default, but every table in this
codebase adds explicit policies anyway so the intent is documented, not
just implied. Template for user-owned tables (the caller reads/writes only
their own rows directly via the anon-key client):

```sql
ALTER TABLE public.[table_name] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "[table]_read_own" ON public.[table_name]
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "[table]_insert_own" ON public.[table_name]
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

For service-role-only tables (tokens, OTP codes, and anything else the
backend alone reads/writes — the service-role client bypasses RLS
regardless of policies, so these exist to make "no client-direct access"
explicit rather than relying on the implicit zero-policy deny):

```sql
ALTER TABLE public.[table_name] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "[table]_no_direct_access" ON public.[table_name]
  FOR SELECT USING (false);

CREATE POLICY "[table]_no_insert" ON public.[table_name]
  FOR INSERT WITH CHECK (false);
```

This is the pattern every existing service-role-only table already uses
(`mfa_sms_challenges`, `mfa_totp_secrets`, `password_reset_tokens`,
`mfa_recovery_tokens`, `institution_codes`, `email_otp_codes`) — use it
instead of `FORCE ROW LEVEL SECURITY` (not used anywhere in this codebase
and unnecessary here: Supabase's `service_role` Postgres role already
bypasses RLS, `FORCE` only affects the table owner, not that role).

Do NOT add `auth.uid() = user_id`-style ownership policies to a table the
backend writes on the user's behalf with its own validation logic layered
on top (rate limits, hashing, attempt caps, etc.) — that would let a
client bypass all of it by calling Supabase directly with the anon key.
`email_otp_codes` is the concrete example: see its own migration comment.

## Log levels and monitoring

Set LOG_LEVEL in .env or Render environment:
  debug — all logs (use now during development)
  info  — business events only (use at public launch)
  warn  — warnings and errors
  error — errors only

Current Render setting: LOG_LEVEL=debug

To view logs:
  Render → alumini → Logs tab → Application logs

Useful log searches in Render:
  [ERROR]     — all errors
  [AUTH]      — authentication events
  [CORRIDOR]  — messaging events
  [CLASSROOM] — classroom events
  [DM]        — direct messages
  [VERIFY]    — verification events

To change log level without redeploying:
  Render → alumini → Environment → LOG_LEVEL → Save
  Service restarts automatically with new level.
