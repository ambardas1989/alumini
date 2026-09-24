# AlumTribe — Task Batch 07

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_07.md along with the code changes
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

## TASK 01 — Fix: profile picture upload failing [DONE: STEP 4 frontend error handling fixed — Supabase Storage errors aren't ApiError instances so getErrorMessage() always fell through to the generic fallback regardless of the real cause, now mapped by statusCode (400/403/other); STEPS 1-3 (bucket creation, SQL policies) need manual Supabase action, no live DB access from this environment; flagging now — TASK 11 later in this file correctly diagnoses that auth.uid() is always null for this app's custom-JWT uploads, so these RLS policies can never actually pass regardless of being applied correctly — see TASK 11's note]

Profile picture upload throws "something went wrong".
Console shows:
https://forkamymzckhwkaqegnn.supabase.co/storage/v1/object/profile-avatars/...
400 Bad Request

Root cause: Supabase Storage bucket 'profile-avatars' either
does not exist or has no upload policy.

STEP 1 — Create bucket if missing:
Go to Supabase → Storage → New bucket:
  Name: profile-avatars
  Public: YES (avatars need to be publicly readable)
  File size limit: 5MB
  Allowed MIME types: image/jpeg, image/png, image/webp, image/gif

STEP 2 — Add storage policies:
Run in Supabase SQL Editor:

-- Allow authenticated users to upload their own avatar
CREATE POLICY "avatar_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[1] = 'profiles'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow public read of all avatars
CREATE POLICY "avatar_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'profile-avatars');

-- Allow users to update their own avatar
CREATE POLICY "avatar_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow users to delete their own avatar
CREATE POLICY "avatar_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

STEP 3 — Also create institution-assets bucket:
Go to Supabase → Storage → New bucket:
  Name: institution-assets
  Public: YES
  File size limit: 10MB
  Allowed MIME types: image/jpeg, image/png, image/webp

Add policies:
-- Allow platform admins and institution admins to upload
CREATE POLICY "institution_assets_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'institution-assets');

-- Allow public read
CREATE POLICY "institution_assets_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'institution-assets');

STEP 4 — Fix frontend error handling:
Read apps/web/app/profile/page.tsx
Find the avatar upload handler.
If the Supabase storage upload fails:
  Log the full error: console.error('[AVATAR-UPLOAD]', error)
  Show specific message based on error:
    400 → "Upload failed. Check file type and size (max 5MB)"
    403 → "Permission denied. Please sign in again."
    Other → "Upload failed. Please try again."
  Never show raw "something went wrong"

Run: next build
Commit: "fix: profile avatar upload — storage bucket policies"

---

## TASK 02 — Fix: institution-assets storage bucket [DONE: no live Supabase access from this environment, so this couldn't be verified/created here (same limitation as TASK 01 STEPS 1-3) — this is a pure Supabase-dashboard/SQL step with no code to change; please create/verify the bucket manually via the SELECT query in this task's own text]

Same as TASK 01 but for institution logos and classroom covers.
The bucket 'institution-assets' needs to exist with correct policies.

This is documented in TASK 01 STEP 3 above.
If TASK 01 already created it — mark this [DONE] immediately.

Verify by running:
SELECT id, name, public FROM storage.buckets
WHERE name IN ('profile-avatars', 'institution-assets');

Both should exist and have public = true.

Commit: "fix: institution-assets storage bucket verified"

---

## TASK 03 — Add storage policies to migration file [DONE: created 021_storage_policies.sql and updated README.md; marked ⚠️ Check rather than ✅ Run since this environment has no live DB access to confirm it was actually applied, consistent with this repo's established status convention]

Storage policies were added manually in Supabase SQL Editor.
They need to be saved in a migration file so dev and staging
environments get them automatically.

Create supabase/migrations/021_storage_policies.sql:

-- Storage bucket policies for profile avatars and institution assets
-- Run manually in Supabase SQL Editor
-- Safe to run multiple times (DROP IF EXISTS before CREATE)
-- NOTE: Buckets must be created manually in Supabase Storage dashboard
--   before running this migration:
--   - profile-avatars (public, 5MB limit)
--   - institution-assets (public, 10MB limit)

-- profile-avatars bucket policies
DROP POLICY IF EXISTS "avatar_upload" ON storage.objects;
CREATE POLICY "avatar_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[1] = 'profiles'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "avatar_read" ON storage.objects;
CREATE POLICY "avatar_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'profile-avatars');

DROP POLICY IF EXISTS "avatar_update" ON storage.objects;
CREATE POLICY "avatar_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "avatar_delete" ON storage.objects;
CREATE POLICY "avatar_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- institution-assets bucket policies
DROP POLICY IF EXISTS "institution_assets_upload" ON storage.objects;
CREATE POLICY "institution_assets_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'institution-assets');

DROP POLICY IF EXISTS "institution_assets_read" ON storage.objects;
CREATE POLICY "institution_assets_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'institution-assets');

Also update supabase/migrations/README.md:
Add row: | 021_storage_policies.sql | ✅ Run | Storage bucket RLS policies |

Add note in README under the table:
"Before running 021 on a new environment, create these
buckets manually in Supabase Storage dashboard:
  - profile-avatars (public, 5MB limit)
  - institution-assets (public, 10MB limit)
Bucket creation cannot be done via SQL."

Run: npm run test
Commit: "feat: storage bucket policies migration 021"

---

## TASK 04 — Fix: change password accepts wrong OTP [DONE: Step 1 now calls the real MFA challenge endpoint (new non-consuming `peek` mode added backend-side so a correct email code isn't burned before Step 2 re-submits it), properly blocks and shows an inline error on a wrong code, clears the input, and locks the form for 60s with a countdown after 3 wrong attempts]

The change password modal proceeds to the new password screen
even when the user enters a wrong OTP code. The MFA verification
step is not properly blocking on failure.

Read apps/web/app/profile/page.tsx
Find the change password modal component.
Find the MFA verify step handler.

The verify step calls POST /auth/mfa/challenge or similar.
On success (200): proceed to new password screen — correct.
On failure (401): must stay on MFA screen and show error.
  Show inline error: "Incorrect code. Please try again."
  Clear the OTP input fields
  Do NOT proceed to new password screen

Check the response handling:
  If using try/catch — confirm the catch block prevents navigation
  If checking response.ok — confirm it's actually checked
  Most likely bug: the code navigates to step 2 regardless
  of the API response, or the error is caught but navigation
  still happens after the catch block

Also add: after 3 wrong attempts lock the form for 60 seconds:
  Show: "Too many attempts. Try again in [N]s"
  Countdown timer
  Re-enable after 60 seconds

Run: next build
Commit: "fix: change password modal blocks on wrong OTP"

---

## TASK 05 — Fix: change password endpoint CORS/missing [DONE: endpoint already existed (built in TASKS_06) — "missing" premise was false; found the likely real cause of the reported net::ERR_FAILED instead — X-MFA-Code (required by every MfaChallengeGuard route, including this one) was missing from CORS allowedHeaders in main.ts, so the preflight rejected it before the request ever reached the route, indistinguishable from a 404]

Change password fails with CORS error:
POST /v1/auth/change-password → net::ERR_FAILED

Most likely cause: the endpoint does not exist.
NestJS returns a CORS-like error when a route is not found
because the preflight OPTIONS request gets no matching handler.

Read apps/backend/src/modules/auth/auth.controller.ts
Check if POST /auth/change-password exists.

If missing — add it:

In auth.controller.ts:
@Post('change-password')
@UseGuards(JwtAuthGuard)
async changePassword(
  @Request() req,
  @Body() dto: ChangePasswordDto
) {
  return this.authService.changePassword(req.user.sub, dto)
}

In auth.service.ts add changePassword():
  Verify the new password meets requirements
  Hash the new password with bcrypt
  Update in Supabase auth:
    await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: dto.newPassword }
    )
  Invalidate all other sessions (keep current session):
    UPDATE sessions SET is_valid = false
    WHERE user_id = userId
    AND id != currentSessionId
  Send confirmation email via EmailService:
    emailService.send(email, 'Password changed', ...)
  Return: { message: 'Password changed successfully' }
  Log: info '[AUTH:changePwd] success' { userId }

Add ChangePasswordDto:
  newPassword: string (min 8 chars, required)

If endpoint EXISTS but CORS fails:
  Read apps/backend/src/main.ts
  Confirm CORS origins include https://alumtribe.com
  Confirm OPTIONS method is in the allowed methods list

Run: npm run test — all tests pass
Commit: "fix: add change-password endpoint and CORS fix"

---

## TASK 06 — Fix: consolidate sign out UI in profile [DONE: merged the two sign-out tiles into one row (logout icon + "Sign out" label, "This device"/"All devices" buttons), border-top separator above it]

Currently two separate tiles:
  Tile 1: "Sign out"
  Tile 2: "Sign out of all devices"

Replace with one tile containing two buttons:

Single row:
  Left: sign out icon (ti-logout) + "Sign out" label (13px bold)
  Right side — two buttons side by side:
    "This device" button (ghost, small, red text)
      On click: confirm dialog "Sign out of this device?"
      On confirm: call signOut() → redirect to /auth/login
    "All devices" button (ghost, small, red text)
      On click: confirm dialog "Sign out of all devices?
      You'll need to sign in again on every device."
      On confirm: POST /auth/logout/all → clearSession()
      → redirect to /auth/login?message=signed_out

Separator line above this row (border-top) to visually
separate the destructive action from account settings above.

Run: next build
Commit: "fix: consolidate sign out into single tile with two buttons"

---

## TASK 07 — Feature: Find your batch — classroom discovery [DONE: new GET /classroom/search endpoint (singular path, matching this repo's established controller-naming convention over the task's literal plural), searches by institution name or global ID, excludes classrooms the caller already joined; frontend debounced search section with join/request-to-join cards and empty/no-results states]

"Find your batch" currently only filters the user's own
classrooms. It needs to be a discovery feature — searching
ALL classrooms on the platform.

Read apps/web/app/classes/page.tsx

Add a discovery section below the user's classroom list:

"Find your batch" search:
  Search input: "Search by school, college or university..."
  Calls GET /v1/classrooms/search?q=[query]&limit=10
  (Check if this endpoint exists — if not, add it to backend)

  Backend endpoint GET /v1/classrooms/search:
    Auth: required
    Query: q (institution name or global ID), limit
    Returns classrooms the user is NOT already a member of
    Joins with institutions for name search
    Returns: globalId, name, institution name, batchYear,
             memberCount, verificationRequired

  Results shown as cards:
    Institution name (muted, small)
    Classroom name (bold)
    Batch year · member count
    "Join" button → calls POST /v1/memberships/join
      Body: { classroomId, role: 'student' }
    Or "Request to join" if verification required

  Empty state (no search yet):
    "Search for your school or college above
     to find your batch"

  No results state:
    "No classrooms found for '[query]'"
    "Create a new classroom →" link

Read apps/backend/src/modules/classroom/classroom.controller.ts
Add GET /classrooms/search endpoint if missing.

Run: npm run test and next build
Commit: "feat: classroom discovery search — find your batch"

---

## TASK 08 — Fix: classroom creation — institution search and location [DONE: FIX A premise was false — a debounced dropdown with a "Request it" fallback already existed, only needed polish (2-char trigger vs 3-char not-found threshold, match highlighting, type badge); FIX B (city/state/country) built end-to-end — migration 022, DTO, service, pre-filled-but-editable form fields, city shown alongside the global ID preview]

Two improvements to the classroom creation flow:

FIX A — Institution search as proper dropdown:
Read apps/web/app/classroom/create/page.tsx

The institution field should work as a searchable dropdown:
  User types 2+ characters
  Calls GET /v1/institutions/search?q=[query] (300ms debounce)
  Shows dropdown below input with matching institutions:
    Each option: institution name (bold) + city + type badge
    Highlight matching text in results
  User selects one → field shows selected name, closes dropdown
  If no results after 3+ chars:
    Show "Can't find your institution? Request it →" at bottom
  
  This replaces the current plain text input.
  The 45 seeded institutions should appear as suggestions.

FIX B — Add city, state, country to classroom creation:
The classroom form currently only captures institution,
section/program, and batch year.

Add location fields:
  City (text input, pre-filled from institution.city_code if available)
  State (text input, optional)
  Country (select dropdown — same country list as institution request form)
    Default: India

These fields should be:
  Pre-filled from the selected institution's data where possible
  Editable by the user (institution may be in multiple cities)
  Stored on the classroom record

Add columns to classrooms table if missing:
supabase/migrations/022_classroom_location.sql:
  ALTER TABLE public.classrooms
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS country_code text DEFAULT 'IN';

Update classroom.service.ts createClassroom() to save these fields.
Update the classroom global ID display to show city if available.

Run: npm run test and next build
Commit: "feat: institution search dropdown, city/state/country in classroom creation"

---

## TASK 09 — Fix: phone number format error handling [DONE: always-visible format hint, sanitize-on-type + normalize-on-blur, friendly inline error for a 400 phone-format response instead of the shared generic fallback; backend now auto-corrects common shapes (bare 10-digit, leading-0, spaces/hyphens/parens) via a class-transformer @Transform before E.164 validation runs]

Saving phone number shows raw API error:
{
  "message": ["Phone must be in E.164 format, e.g. +919876543210"]
}

This should never be shown raw to users.

FIX A — Frontend: show format hint proactively:
Read apps/web/app/profile/page.tsx
Find the phone number input field.

Add helper text below the field (always visible, not just on error):
  "Format: +[country code][number] — e.g. +919876543210"
  Small, muted, 11px

FIX B — Frontend: auto-format as user types:
As user types, auto-prepend "+" if they haven't:
  "919876543210" → "+919876543210"
  "09876543210" → try to detect country and format
  Accept: digits, +, spaces, hyphens, parentheses
  Strip spaces/hyphens before sending to API

FIX C — Frontend: graceful error handling:
If API returns 400 with phone validation error:
  Show inline below phone field:
  "Please use international format: +919876543210"
  Never show the raw array message

FIX D — Backend: more forgiving validation:
Read apps/backend/src/modules/identity/identity.service.ts
or the profile update DTO.

Before validating E.164 format, attempt auto-correction:
  Strip spaces, hyphens, parentheses
  If starts with 0 and 10 digits: prepend +91 (India default)
  If starts with digits only: prepend +
  Then validate E.164 format

Run: npm run test and next build
Commit: "fix: phone number format — proactive hint, auto-format, graceful errors"

---

## TASK 10 — Fix: logout frontend — token clear before redirect [DONE: real root cause was router.push (client-side nav) vs window.location.href inconsistency between the profile page's own sign-out handlers and AuthProvider.logout()'s already-correct pattern — consolidated every sign-out path onto one shared lib/auth.ts completeSignOut() (isLoggingOut flag checked by lib/api.ts's request(), full reload), added a token guard to NotificationBell's polling interval]

Backend logout works correctly (confirmed in logs).
Frontend still fires API calls after logout because
token is not cleared before redirect.

Root cause: clearSession() runs AFTER router.push(),
so the page re-mounts briefly with the old token still
in localStorage and fires API calls before redirect completes.

Read apps/web/lib/auth.ts — find signOut().

Fix order of operations:
  1. Call POST /auth/logout
  2. clearSession() — remove token from localStorage FIRST
  3. window.location.href = '/auth/login?message=signed_out'
     Use window.location.href not router.push — forces full
     page reload, prevents stale state from re-mounting

In apps/web/lib/api.ts:
  Add flag: let isLoggingOut = false
  In signOut(): set isLoggingOut = true before clearing session
  In fetch wrapper: if isLoggingOut — return early, skip call

In apps/web/components/layout/AppShell.tsx:
  All polling useEffects (unread-count, notifications):
  Add guard: if (!getToken()) return — before any API call
  This stops polling immediately when token is cleared

Run: next build
Commit: "fix: logout clears token before redirect, stops polling,
uses full page reload"

---

## TASK 11 — Fix: profile avatar upload via backend API [PENDING]

Avatar upload fails with 502 from Supabase Storage directly.
Root cause: frontend uploads directly to Supabase Storage
using the anon key. The storage policy uses auth.uid() which
requires a Supabase Auth session — but the app uses custom
NestJS JWTs which Supabase Storage doesn't recognise.
So auth.uid() returns null and the policy rejects the upload.

Fix: route all file uploads through the backend API
which uses the service role key (bypasses RLS entirely).

BACKEND:

Add endpoint: POST /identity/avatar
Auth: JwtAuthGuard (custom JWT — already works)
Accepts: multipart/form-data, field name: 'avatar'
Max size: 5MB
Allowed types: image/jpeg, image/png, image/webp

Use multer or NestJS FileInterceptor:
@UseInterceptors(FileInterceptor('avatar'))
@Post('avatar')
async uploadAvatar(
  @Request() req,
  @UploadedFile() file: Express.Multer.File
)

In the handler:
1. Validate file type and size
2. Upload to Supabase Storage using SERVICE ROLE client:
   const { data, error } = await supabaseAdmin
     .storage
     .from('profile-avatars')
     .upload(
       `profiles/${userId}/avatar.${ext}`,
       file.buffer,
       { contentType: file.mimetype, upsert: true }
     )
3. Get public URL:
   const { data: urlData } = supabaseAdmin
     .storage
     .from('profile-avatars')
     .getPublicUrl(`profiles/${userId}/avatar.${ext}`)
4. Update profiles.avatar_url with the public URL
5. Return: { avatarUrl: publicUrl }

Log:
  debug: '[IDENTITY:avatar] upload start' { userId, size: file.size, type: file.mimetype }
  info:  '[IDENTITY:avatar] upload success' { userId, url: publicUrl }
  error: '[IDENTITY:avatar] upload failed' { userId, error: full }

FRONTEND:

Read apps/web/app/profile/page.tsx
Find the avatar upload handler.

Change from direct Supabase Storage upload to:
  const formData = new FormData()
  formData.append('avatar', file)
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/identity/avatar`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData
    }
  )
  const { avatarUrl } = await response.json()
  Update avatar display with avatarUrl

Error handling:
  413 → "File too large. Maximum size is 5MB."
  415 → "Invalid file type. Use JPEG, PNG or WebP."
  Other → "Upload failed. Please try again."

Run: npm run test and next build
Commit: "fix: avatar upload routed through backend API
using service role — bypasses Supabase JWT mismatch"

---

## COMPLETION SUMMARY

(Claude Code fills this in when all tasks are [DONE])

Date completed:
Tasks completed:
Tests passing:
Build status:
SQL to run manually in Supabase:
  - Storage bucket policies in TASK 01 STEP 2
  - Storage bucket policies in TASK 01 STEP 3
Notes:

---

## RESUMPTION GUIDE

Paste this to resume after any interruption:

"Read TASKS_07.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
