# AlumTribe — Task Batch 06

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_06.md along with the code changes
- If a task fails, change [PENDING] to [FAILED: reason] and STOP
- Do not move to the next task until the current one fully passes
- Run `npm run test` after every task — all tests must pass
- Run `next build` after any frontend task before committing
- All commits go to main

If resuming after interruption:
- Read this file first
- Find the first task still [PENDING]
- Start from there

---

## TASK 01 — Fix: duplicate email error on signup [DONE: inline "account exists" message + sign-in/reset links under email field; fixed a latent bug where the password's custom validator message never matched its field key and silently vanished; friendlier copy for default class-validator email/password messages]

When a user tries to sign up with an already registered email,
the API returns:
{
  "statusCode": 400,
  "message": "A user with this email address has already been registered"
}

The frontend currently shows this raw message or a generic
"something went wrong" — neither is acceptable.

Read apps/web/app/auth/signup/page.tsx

Fix the error handling for this specific case:

When the API returns 400 with message containing
"already been registered" or "already registered"
or "email address has already":

Show a friendly inline message below the email field:
  "An account with this email already exists."
  Below that: "Sign in instead →" link to /auth/login
  Or: "Forgot your password? Reset it →" link to /auth/forgot-password

Do NOT show:
  - The raw API error message
  - "Something went wrong"
  - A generic red error box without guidance

Also handle these other signup error cases if not already done:
  400 weak password → "Password must be at least 8 characters"
  400 invalid email → "Please enter a valid email address"
  500 → "Server error. Please try again in a moment."
  Network → "Connection issue. Check your internet."

Run: next build
Commit: "fix: graceful duplicate email error on signup with sign in link"

---

## TASK 02 — Fix: run all pending Supabase migrations [DONE: no live Supabase DB access from this environment (confirmed with user) — updated README.md honestly (⚠️ Check rows require manual verification, not fabricated ✅), documented idempotency of each pending migration, corrected a task-list typo (mfa_recovery_codes → the real table is mfa_recovery_tokens, already applied), added the pre-deploy checklist to DEVELOPMENT.md]

Several features are failing because migration files exist
in the repo but were never run in Supabase.

Read supabase/migrations/README.md for the full list.

Check which of these tables exist in Supabase by running:
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

For any table marked as missing — run the corresponding
migration file in Supabase SQL Editor.

Known missing tables that have caused production errors:
- email_otp_codes (was run manually above — confirm it exists)
- institution_requests (check)
- mfa_recovery_tokens (check)
- mfa_recovery_codes (check)

After confirming all tables exist:
Update supabase/migrations/README.md to mark each as
✅ Run or ⚠️ Missing.

Also add a pre-deploy checklist to docs/DEVELOPMENT.md:

## Before deploying a new feature

1. Check if any new migration files were added
2. Run them in Supabase SQL Editor IN ORDER
3. Verify the table exists before testing the feature
4. Update supabase/migrations/README.md status

This prevents PGRST205 "table not found" errors in production.

Commit: "docs: update migration status, pre-deploy checklist"

---

## TASK 03 — Fix: add RLS policies to all new tables [DONE: full static audit — all 23 tables across every migration already have RLS + policies; institution_requests/mfa_recovery_tokens premise was false (already policied); only email_otp_codes lacked explicit deny policies, now added; declined the literal auth.uid()-ownership policy suggestion for email_otp_codes as a real security regression; added corrected RLS rule template to DEVELOPMENT.md]

Every new table created in recent migrations is missing
RLS policies, causing 42501 errors in production.

Tables confirmed missing policies:
- email_otp_codes (fixed manually above — add to migration)
- institution_requests (check)
- mfa_recovery_tokens (check)
- mfa_recovery_codes (check)

Run this in Supabase SQL Editor to check all tables:
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename NOT IN (
  SELECT DISTINCT tablename
  FROM pg_policies
  WHERE schemaname = 'public'
);

This shows tables with NO policies at all.

For each table found — add appropriate RLS policies.

Also update the migration files to include RLS policies
so future environments (dev, staging) don't hit the same issue.

Update supabase/migrations/018_email_otp_mfa.sql to include:

CREATE POLICY "email_otp_insert"
  ON public.email_otp_codes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "email_otp_select"
  ON public.email_otp_codes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "email_otp_update"
  ON public.email_otp_codes FOR UPDATE
  USING (auth.uid() = user_id);

Also add to docs/DEVELOPMENT.md:

## RLS policy rule

Every new table MUST have RLS policies defined in its
migration file. Template for user-owned tables:

ALTER TABLE public.[table_name] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "[table]_select" ON public.[table_name]
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "[table]_insert" ON public.[table_name]
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "[table]_update" ON public.[table_name]
  FOR UPDATE USING (auth.uid() = user_id);

For service-role-only tables (tokens, OTP codes):
ALTER TABLE public.[table_name] FORCE ROW LEVEL SECURITY;
-- No user-facing policies — service role bypasses RLS

Run: npm run test
Commit: "fix: RLS policies for all new tables, update migrations"

---

## TASK 04 — Fix: MFA screen missing back button [DONE: added top-left back button (hand-rolled SVG arrow, matching AuthLayout's existing icon convention — no icon font/package installed in this repo) that clears the pending MFA session and returns to /auth/login; "Having trouble? Sign in again" link already existed for verify mode]

The MFA page (/auth/mfa) has no way to go back.
If a user enters the wrong email or wants to cancel,
they are stuck.

Read apps/web/app/auth/mfa/page.tsx

Add a back button at the top left of the MFA page:
  Arrow left icon (ti-arrow-left, 20px)
  Text: "Back" or just the icon
  On click: router.push('/auth/login')
  Style: ghost, small, muted color

Also add "Having trouble? Sign in again" link at the
bottom if not already present:
  → /auth/login
  Small, muted, centered below the Verify button

Run: next build
Commit: "fix: add back button to MFA page"

---

## TASK 05 — Fix: change password flow UX [DONE: two-step modal (MFA verify → new password) replacing the old forgot-password-email-link flow; new POST /auth/change-password endpoint reusing MfaChallengeGuard; found and fixed a real pre-existing bug — verifyCode()'s EMAIL branch always checked purpose 'login' for every non-setup challenge, so MfaChallengeGuard (institution admin, codes, verification-review routes) never actually worked for email-MFA users]

Currently "Change password" sends an OTP code directly
which is wrong. The correct flow is:

1. User clicks "Change password" in profile
2. Modal/popup opens (not a page navigation)
3. Step 1 — MFA verification:
   If mfa_method = 'email': send OTP to email, show 6-digit input
   If mfa_method = 'totp': show "enter your authenticator code"
   User enters code and clicks "Verify"
4. Step 2 — New password (only shown after successful MFA):
   "New password" input with strength indicator
   "Confirm new password" input
   "Change password" button (primary)
5. On success:
   Close modal
   Show success toast: "Password changed successfully"
   Do NOT log the user out

Read apps/web/app/profile/page.tsx
Find the "Change password" button handler.

Replace current flow with a modal:
- Use a dialog/modal component (not a page)
- Two-step flow: MFA verify → new password form
- MFA step calls POST /auth/mfa/challenge or sends OTP
  depending on user's mfa_method from profile
- Password step calls POST /auth/reset-password or
  PATCH /v1/identity/profile with { password: newPassword }
  (check which endpoint exists for authenticated password change)
- Close modal on success, show toast

Run: next build
Commit: "fix: change password — modal with MFA verification step"

---

## TASK 06 — Fix: logout redirect and 401 cascade [DONE: Fix 1 (redirect target) and Fix 2 (global 401 handler) both already existed correctly — premise about lib/auth.ts's signOut() was false, no such function exists there; real gap found was Fix 3 — app/onboarding/page.tsx and app/onboarding/claim/page.tsx were the only two protected pages missing the existing useRequireAuth() guard every other page already uses, now added to both]

After logout the app redirects to home/classroom instead
of login page, causing a cascade of 401 errors as the
app tries to fetch data without a token.

Read apps/web/lib/auth.ts — find signOut() function.

Fix 1 — Redirect to login after logout:
After calling clearSession() the redirect must go to:
  /auth/login?message=signed_out
Not to / or any other page.

Fix 2 — Global 401 handler:
In apps/web/lib/api.ts find the fetch wrapper.
If any API call returns 401:
  Call clearSession()
  Redirect to /auth/login?message=session_expired
  Stop making further API calls

This prevents the cascade of 401s when the token expires
or is cleared while the user is on a page.

Fix 3 — Auth guard on protected pages:
In apps/web/components/layout/AppShell.tsx or the root
layout, add an auth check on mount:
  If no token in localStorage → redirect to /auth/login
  Do this before making any API calls

Run: next build
Commit: "fix: logout redirects to login, global 401 handler,
auth guard on protected pages"

---

## TASK 07 — Fix: privacy policy accuracy [PENDING]

The privacy policy makes claims that need updating
to reflect the actual tech stack in use.

Read apps/web/app/privacy/page.tsx

Update "What we collect" section to add:
- LinkedIn profile data (if user connects LinkedIn):
  name, job title, company, location, education history

Update "What we never do" section — add honest disclosure:
- We never sell your data or show ads (keep this)
- Remove "except Supabase and Google" and replace with:
  "We use the following trusted services to operate AlumTribe:
   Supabase (database and authentication),
   Render (application hosting),
   Cloudflare (content delivery and DNS),
   Resend (transactional emails),
   Google (sign-in, if you use Google login),
   LinkedIn (profile sync, only if you connect LinkedIn).
   Each provider has their own privacy policy.
   We do not sell your data to any of these providers."

Update "Your rights" section to clarify:
- Account deletion: "Email hello@alumtribe.com to request
  account deletion. We will delete your data within 30 days."
  (Note: self-service delete is not yet built — this is the
  interim process until we build it in the app)

Update "How we protect it" — add:
- "We use Cloudflare to protect against DDoS attacks
  and malicious traffic. Cloudflare may log your IP address."

Add new section "Data retention":
- Messages: kept until you delete them or your account
- Verification documents: automatically deleted after 30 days
- OTP codes: automatically deleted after use or expiry
- Account data: kept until you request deletion

Run: next build
Commit: "fix: privacy policy updated to reflect actual tech stack"

---

## TASK 08 — Feature: session security hardening [PENDING]

Implement proper session management — P1 and P2 features
plus device fingerprinting for forensics logging.

Read apps/backend/src/modules/auth/auth.service.ts
Read apps/backend/src/modules/auth/auth.controller.ts
Read the JWT guard (apps/backend/src/common/guards/ or similar)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
P1 — Server-side session validation on every request
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Currently the JWT guard likely only verifies the JWT
signature — it does NOT check the sessions table.
This means logout is client-side only — a stolen token
stays valid for 7 days.

Find the JWT guard (JwtAuthGuard or similar).
In the canActivate() or validate() method, after
verifying the JWT signature, add a session check:

const session = await supabaseAdmin
  .from('sessions')
  .select('id, is_valid, expires_at')
  .eq('user_id', userId)
  .eq('token_hash', hashToken(jwtToken))
  .single()

If session not found or is_valid = false:
  throw UnauthorizedException('Session expired or revoked')
If session.expires_at < now():
  throw UnauthorizedException('Session expired')

This makes logout truly effective server-side.

Check sessions table schema — confirm it has:
  id, user_id, token_hash, is_valid, expires_at, created_at
If token_hash column missing:
  ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS token_hash text;
  Add to a migration file.

When creating a session in createSession():
  Store hash of the JWT token:
  token_hash: crypto.createHash('sha256')
    .update(jwtToken).digest('hex')

When logging out in logout():
  Mark session as invalid:
  UPDATE sessions SET is_valid = false
  WHERE user_id = userId AND token_hash = hash

Add migration if needed:
supabase/migrations/020_session_token_hash.sql

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
P2a — Sign out all devices
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add endpoint: POST /auth/logout/all
Auth: required
Logic:
  UPDATE sessions SET is_valid = false
  WHERE user_id = userId
  Return: { message: 'Signed out from all devices', count: N }
  Log: info '[AUTH:logoutAll] all sessions revoked' { userId, count }

In apps/web/app/profile/page.tsx account section:
Add "Sign out all devices" button below the regular sign out:
  Label: "Sign out all devices"
  Style: ghost, small, red text
  Confirm dialog: "This will sign you out from all browsers
  and devices. Continue?"
  On confirm: POST /auth/logout/all
  Then: clearSession() + redirect to /auth/login

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
P2b — Active sessions list in profile
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add endpoint: GET /auth/sessions
Auth: required
Returns all active sessions for current user:
  SELECT id, device_info, ip_address, created_at, last_seen_at
  FROM sessions
  WHERE user_id = userId AND is_valid = true
  ORDER BY last_seen_at DESC

Check sessions table for these columns — add if missing:
  device_info text (populated from User-Agent header)
  ip_address text (populated from request IP)
  last_seen_at timestamptz (updated on each authenticated request)

Add to sessions table migration:
supabase/migrations/020_session_token_hash.sql:
  ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS device_info text,
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_valid boolean NOT NULL DEFAULT true;

Update createSession() to populate these fields:
  device_info: request headers User-Agent (truncated to 255 chars)
  ip_address: request IP (use X-Forwarded-For if behind Cloudflare)
  last_seen_at: now()

Update the JWT guard to update last_seen_at on each request:
  UPDATE sessions SET last_seen_at = now()
  WHERE token_hash = hash
  (do this async — don't await, don't block the request)

Add endpoint: DELETE /auth/sessions/:sessionId
Auth: required
Revokes a specific session (not the current one):
  UPDATE sessions SET is_valid = false
  WHERE id = sessionId AND user_id = userId
  (user can only revoke their own sessions)

In apps/web/app/profile/page.tsx security section:
Add "Active sessions" section:
  Heading: "ACTIVE SESSIONS"
  Fetch GET /auth/sessions on mount

  Each session as a row:
    Left: device icon (ti-device-laptop or ti-device-mobile)
      based on device_info containing 'Mobile' or not
    Center:
      Device info (truncated, 13px)
      "Last active: [relative time]" (11px muted)
      IP: "[ip_address]" (10px muted)
    Right: "Revoke" link (small red) if not current session
      Current session shows "Current" green badge instead

  "Sign out all other devices" link at bottom
    Calls POST /auth/logout/all then re-fetches sessions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
P3 — Device fingerprinting for forensics (logs only)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Do NOT block or restrict based on device fingerprint.
Log only — for forensics and debugging.

In the JWT guard, after successful authentication,
log this at debug level:
  this.logger.debug('[AUTH:fingerprint]', {
    userId,
    userAgent: request.headers['user-agent']?.slice(0, 100),
    ip: request.headers['x-forwarded-for'] ||
        request.socket?.remoteAddress,
    referer: request.headers['referer'],
    sessionId: session?.id
  })

In login() after successful auth:
  this.logger.info('[AUTH:login:device]', {
    userId,
    userAgent: request.headers['user-agent']?.slice(0, 100),
    ip: request.headers['x-forwarded-for'] ||
        request.socket?.remoteAddress,
    isNewDevice: isFirstSessionForThisDevice
  })

This gives forensic trail in Render logs:
  - Which device/browser logged in
  - IP address of each login
  - When sessions were last used
  Without blocking anyone or requiring device verification.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDLE TIMEOUT (frontend)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add idle timeout detection in apps/web/components/layout/AppShell.tsx:

const IDLE_TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes
const WARN_BEFORE_MS  = 2 * 60 * 1000   // warn 2 min before

On mount: start tracking user activity
  Track: mousemove, keydown, click, scroll, touchstart
  Reset idle timer on any activity

After IDLE_TIMEOUT_MS - WARN_BEFORE_MS of inactivity:
  Show a modal/toast:
  "Still there? You'll be signed out in 2 minutes."
  "Stay signed in" button → reset timer
  "Sign out now" button → call signOut()

After full IDLE_TIMEOUT_MS of inactivity:
  Call signOut() automatically
  Redirect to /auth/login?message=session_expired

Only run idle detection when user is authenticated.
Respect: clear timer on logout, remove listeners on unmount.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AFTER ALL CHANGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create supabase/migrations/020_session_token_hash.sql
with all ALTER TABLE statements for sessions table.
Document: must be run manually in Supabase SQL Editor.

Run: npm run test — all tests must pass
Run: next build — 0 errors
Commit: "feat: server-side session validation, sign out all devices,
active sessions list, idle timeout, device fingerprint logging"
Push.

After pushing run in Supabase SQL Editor:
supabase/migrations/020_session_token_hash.sql

---

## COMPLETION SUMMARY

(Claude Code fills this in when all tasks are [DONE])

Date completed:
Tasks completed:
Tests passing:
Build status:
Notes:

---

## RESUMPTION GUIDE

Paste this to resume after any interruption:

"Read TASKS_06.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
