# AlumTribe — Task Batch 05

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_05.md along with the code changes
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

## TASK 01 — Fix: light theme not applying [DONE: re-audited — `apps/web/styles/globals.css` doesn't exist, the real file is `apps/web/app/globals.css` (documented at its own top), and its `:root` block already has --color-bg: #f0ecff, --color-surface: #ffffff exactly as specced; the grep for hardcoded #1c1c2e/#2D1B69 in apps/web/app/ found only the classroom header (an explicitly allowed dark context) and the persona-switcher's active card (a documented, explicitly user-requested exception from a prior session's TASK 10, not a regression); AppShell.tsx/layout.tsx have no hardcoded dark class/style, both already use var(--color-bg). No code change made — there is no bug here. What's most likely being seen as "reverted to dark" is one of two legitimate, pre-existing behaviors: the app auto-follows the OS's prefers-color-scheme, or (as of the immediately preceding session) a manual theme toggle now exists in the UI and switches to the real dark palette on click/tap — both working as designed, not a regression]

The app has reverted to dark navy/purple theme after a deployment.
The light theme must be restored permanently.

Read apps/web/styles/globals.css
Check current values of --color-bg, --color-surface, --color-primary-dark.

If --color-bg is a dark color like #1c1c2e or #2D1B69 — fix it.

Correct values:
--color-bg:      #f0ecff   (light purple tint — page background)
--color-surface: #ffffff   (white — cards and panels)

Also check apps/web/app/layout.tsx or any root layout file.
If body or root div has a hardcoded dark background class or
style — remove it. Use var(--color-bg) instead.

Also check apps/web/components/layout/AppShell.tsx
If main content wrapper has a hardcoded dark background — fix it.

Also check every page file for hardcoded dark bg colors:
grep -r "bg-\[#1c1c2e\]\|bg-\[#2D1B69\]\|background.*#1c1c2e\|background.*#2D1B69" apps/web/app/
Replace any found in content areas with var(--color-bg) or white.

Dark colors are ONLY allowed on:
- Auth left panel (AuthLayout.tsx)
- Classroom header (classroom/[globalId]/page.tsx header section)
- Bottom nav bar
- Primary buttons

Run: next build
Commit: "fix: restore light theme permanently"

---

## TASK 02 — Fix: profile — phone number, profile picture [DONE: FIX A's premise didn't match the code — identity.service.ts's updateProfile()/getProfile() and UpdateProfileDto already save/return phone (with a stricter E.164 regex than the task's proposed one, kept as-is), and lib/api.ts's updateProfile() already sends it; the real gap was that the saved phone was never displayed outside the edit form — added a formatted "+91 98765 43210"-style line (lib/format.ts's new formatPhoneDisplay(), documented as a best-effort grouping, not a precise per-country formatter) to the profile header. FIX B — full avatar upload flow added: click-to-pick (jpeg/png/webp, 5MB cap, inline error), immediate object-URL preview with Save/Cancel, upload to the existing public 'profile-avatars' bucket via the same direct-client-upload pattern DocumentMethod.tsx already established, cache-busted public URL saved via the existing PATCH /identity/profile (avatarUrl was already a supported field — no new backend endpoint needed), spinner overlay while uploading, optimistic profile/user state update on success. Avatar display priority (uploaded > Google OAuth photo > initials) was already correct since both sources write the same single avatarUrl field]

Read apps/web/app/profile/page.tsx
Read apps/backend/src/modules/identity/identity.service.ts

FIX A — Phone number not saving:
The phone field shows on profile but changes are not saved.
Find the profile update API call (PATCH /v1/identity/profile
or similar). Confirm phone is included in the request body.
If the backend DTO excludes phone — add it:

In the update profile DTO:
@IsOptional()
@IsString()
@Matches(/^\+?[0-9\s\-\(\)]{7,20}$/, { message: 'Enter a valid phone number' })
phone?: string;

In identity.service.ts updateProfile() — include phone in
the Supabase update call.

Show phone field on profile with edit capability.
Format: "+91 98765 43210" style display when saved.

FIX B — Profile picture upload:
Currently no way to upload a profile picture.

Add avatar upload to profile page:
1. Click on avatar circle → opens file picker
   Accept: image/jpeg, image/png, image/webp
   Max size: 5MB
   Show size error if over limit

2. On file select:
   Show preview immediately (URL.createObjectURL)
   Show "Save" and "Cancel" buttons below avatar

3. On save:
   Upload to Supabase Storage bucket 'profile-avatars'
   Path: profiles/[userId]/avatar.[ext]
   Make bucket public (already exists — confirm)
   Get public URL after upload
   PATCH /v1/identity/profile with { avatarUrl: publicUrl }
   Update avatar display immediately (optimistic)

4. Avatar display priority:
   1. Uploaded photo (avatarUrl from profile)
   2. Google profile photo (from OAuth)
   3. Initials fallback (colored circle)

5. Loading state: spinner overlay on avatar while uploading

Run: npm run test and next build
Commit: "feat: profile phone saving, avatar upload"

---

## TASK 03 — Fix: profile — LinkedIn button styling [DONE: moved LinkedIn out of its own standalone bar/banner into a normal account-section row (LinkedIn icon 20px in var(--color-linkedin), "LinkedIn" bold + "Connected"/"Not connected" muted 11px below, ghost blue-bordered "Connect" button or small red "Disconnect" link on the right) matching the other account rows; "Sync now" was declined — no sync timestamp field exists yet (that's TASK 06's linkedin_synced_at column), so there's nothing for it to do until that lands]

Read apps/web/app/profile/page.tsx
The LinkedIn connect option looks like a bar/banner — bad UI.

Replace it with a proper button in the account section:

Row layout (same as other account rows):
  Left: LinkedIn icon (official blue #0A66C2, 20px)
  Center: "LinkedIn" (13px bold) below: "Not connected" or
    "Connected · [name]" if already connected (muted 11px)
  Right: "Connect" button (ghost, small, blue border)
    or "Sync now" if already connected
    or "Disconnect" link (small, muted red) if connected

When not connected: show "Connect LinkedIn" button
When connected: show last sync time + "Sync now" + "Disconnect"

Run: next build
Commit: "fix: LinkedIn button styling in profile account section"

---

## TASK 04 — Fix: classroom card icons clarification [DONE: the current component (rewritten in a prior session) never actually showed "two ticks" — verified state was a single "✓ Verified" line; replaced it anyway with the clearer stats row the spec asks for: 👥 member count + · + 📍 city (institution.cityCode — no code→name lookup exists anywhere in this app, shown raw the same way ClassroomCreateForm's own institution picker already displays it), 12px muted icons inline with " · " separators; pending state unchanged (already the amber "⏳ Verify to enter" pill). 💬 unread-message count declined — no endpoint tracks that, same standing "don't fabricate data" call this component already made once before. Extended ClassroomCardData.institution with an optional cityCode and threaded it through all 3 call sites (home, classes, profile)]

Read apps/web/components/ClassroomCard.tsx

The classroom tile shows two ticks and a "1 member" count
but the icons are unclear. Users don't know what they mean.

Fix the bottom row of the classroom card:

Remove the two tick icons (confusing, no clear meaning).
Replace with clear icon + label pairs:

If verified member:
  Row: 👥 [N members]  ·  💬 [N unread]
  Use ti-users icon for members, ti-message icon for messages
  Show actual numbers, not ticks

If pending verification:
  Show: "⏳ Verify to enter" amber pill
  (same as mockup)

Member count: use ti-users (people icon) not ticks
Message count: use ti-message-2 (speech bubble)
Location (if institution has city): use ti-map-pin
  Show city name next to the pin icon

All icons: 12px, muted color, inline with text
Separator: " · " between each stat

Run: next build
Commit: "fix: classroom card stats — clear icons and labels"

---

## TASK 05 — Feature: institution and classroom profile pictures [DONE: added logo_url/cover_url columns (migration 016, not yet run in Supabase); backend endpoints POST /institution/:id/logo (platform admin or active institution admin, reuses institution.service.ts's existing assertActiveAdmin) and POST /classroom/:id/cover (verified classroom admin only, matching updateClassroom()'s existing no-school-admin-fallback rule) both accept a JSON { logoUrl/coverUrl } body rather than multipart/form-data — this backend has no multer middleware anywhere (see codes/dto/import-csv.dto.ts's own identical documented decision), so this follows the same direct-client-Storage-upload pattern TASK 02's avatar upload just established: frontend uploads to the public 'institution-assets' bucket, then hands the endpoint just the resulting URL. Frontend: ClassroomCard shows the institution logo image when present (emoji fallback otherwise), classroom header shows the cover photo as a background with a dark overlay plus an admin-only camera-icon upload button, admin dashboard's overview tab gets a logo section with an upload/change button. Extended CLASSROOM_SELECT_COLUMNS/INSTITUTION_JOIN_COLUMNS (classroom.service.ts) and admin.service.ts's getOverview() to surface the new fields, and rebuilt @alumini/types after adding logoUrl/coverUrl to the shared Institution/Classroom interfaces]

Schools, colleges, and classrooms should have their own
display pictures just like user profiles.

BACKEND:

1. Add logo_url column to institutions table:
   Create supabase/migrations/016_institution_logos.sql:

   ALTER TABLE public.institutions
   ADD COLUMN IF NOT EXISTS logo_url text;

   ALTER TABLE public.classrooms
   ADD COLUMN IF NOT EXISTS cover_url text;

   Document: must be run manually in Supabase SQL Editor.

2. Add endpoint: POST /institutions/:institutionId/logo
   Auth: platform admin or institution admin only
   Accepts: multipart/form-data with image file
   Upload to Supabase Storage bucket 'institution-assets'
   Path: institutions/[institutionId]/logo.[ext]
   Update institutions.logo_url with public URL
   Return: { logoUrl: string }

3. Add endpoint: POST /classrooms/:globalId/cover
   Auth: classroom admin only
   Upload to 'institution-assets' bucket
   Path: classrooms/[classroomId]/cover.[ext]
   Update classrooms.cover_url
   Return: { coverUrl: string }

FRONTEND:

1. In ClassroomCard component:
   Institution icon area (40px rounded square):
   If institution.logo_url exists: show logo image
   Else: show emoji fallback (🏫 or 🎓) on colored bg

2. In classroom/[globalId]/page.tsx header:
   If classroom.cover_url exists:
     Show as background image on header with dark overlay
   Else: keep current gradient

3. Allow classroom admin to upload cover from classroom header:
   Small camera icon overlay on header (bottom right)
   Only visible to admins
   On click: opens file picker, uploads, updates immediately

4. Allow institution logo upload from admin dashboard:
   In apps/web/app/admin/page.tsx overview tab:
   Institution logo section:
   Show current logo or placeholder
   "Upload logo" button for platform admins

Run: npm run test and next build
Commit: "feat: institution logos and classroom cover photos"

IMPORTANT: After pushing run in Supabase SQL Editor:
supabase/migrations/016_institution_logos.sql

---

## TASK 06 — Feature: LinkedIn integration [PENDING]

LinkedIn OAuth is already set up for Google sign-in.
This task uses it specifically for profile enrichment
and classroom recommendations.

PRODUCT RULES (important — read carefully):
- Do NOT auto-verify or auto-join classrooms
- Pre-populate profile fields — user must confirm each
- Show classroom RECOMMENDATIONS on home page — user decides
- If no classroom match found: offer to create it
- Periodic background sync monthly for job/location only
- Education data does not re-sync (doesn't change)
- LinkedIn verified badge shown on profile

BACKEND:

1. LinkedIn OAuth is already configured.
   Check apps/backend/src/modules/auth/auth.service.ts
   for LinkedIn OAuth handling.
   If not fully implemented, add:

   POST /auth/linkedin/connect (not login — just connect)
   Auth: required (must already be logged in)
   Exchanges LinkedIn auth code for profile data.
   Pulls these LinkedIn fields:
     - firstName, lastName (for name confirmation)
     - profilePicture (URL)
     - headline (current job title)
     - positions (company, title, start/end date)
     - educations (school, degree, field, start/end year)
     - location (city, country)
   Returns: { linkedinData: { ... } } to frontend
   Does NOT save anything automatically — frontend shows
   confirmation UI first.

2. POST /identity/linkedin/save
   Auth: required
   Body: { confirmedFields: { ... } }
   Only saves fields the user explicitly confirmed.
   Fields to save in profiles table:
     linkedin_connected: boolean
     linkedin_id: string
     linkedin_name: string (for display)
     linkedin_avatar_url: string
     linkedin_headline: string (current role)
     linkedin_company: string
     linkedin_location: string
     linkedin_education: jsonb (array of education entries)
     linkedin_synced_at: timestamptz
   Returns: updated profile + classroom recommendations

3. POST /identity/linkedin/sync
   Auth: required
   Re-fetches LinkedIn data using stored refresh token.
   Only updates: headline, company, location (not education).
   Called by: user clicking "Sync now" on profile.
   Also called by: background job monthly (future — just
   add a TODO comment for now, don't implement cron yet).

4. GET /identity/linkedin/recommendations
   Auth: required
   Reads linkedin_education from the user's profile.
   For each education entry:
     Search institutions table for fuzzy name match
     (use ILIKE %name% — not exact match)
     If institution found:
       Search classrooms for matching year
       Return: { type: 'join', classroom: {...}, confidence: 'high'|'medium' }
     If institution found but no matching classroom:
       Return: { type: 'create', institution: {...}, suggestedYear: year }
     If institution not found at all:
       Return: { type: 'request', institutionName: string, year: number }
   Return all recommendations as an array.
   Maximum 5 recommendations.

5. Add columns to profiles table:
   Create supabase/migrations/017_linkedin_profile.sql:

   ALTER TABLE public.profiles
   ADD COLUMN IF NOT EXISTS linkedin_connected boolean DEFAULT false,
   ADD COLUMN IF NOT EXISTS linkedin_id text,
   ADD COLUMN IF NOT EXISTS linkedin_headline text,
   ADD COLUMN IF NOT EXISTS linkedin_company text,
   ADD COLUMN IF NOT EXISTS linkedin_location text,
   ADD COLUMN IF NOT EXISTS linkedin_education jsonb,
   ADD COLUMN IF NOT EXISTS linkedin_synced_at timestamptz;

   Document: must be run manually in Supabase SQL Editor.

FRONTEND:

1. Profile page — LinkedIn section:
   In account section, replace current LinkedIn bar with
   a proper connection UI:

   NOT CONNECTED state:
     LinkedIn logo (blue, 20px)
     "LinkedIn" bold
     "Connect to verify your education and sync your profile"
       muted 11px
     "Connect LinkedIn" button (blue, ghost style)
     On click: redirect to LinkedIn OAuth

   CONNECTED state:
     LinkedIn logo (blue)
     "LinkedIn" bold + green "Connected" badge
     "[LinkedIn name] · [headline]" muted 11px
     Last synced: "Synced 3 days ago" muted 10px
     "Sync now" link (small, blue)
     "Disconnect" link (small, muted red, right side)

   PENDING CONFIRMATION state (after OAuth returns data):
     Show a confirmation panel/card:
     Heading: "We found your LinkedIn profile"
     Show each field with a checkbox:
       ☑ Profile photo: [preview]
       ☑ Job title: "[headline]"
       ☑ Company: "[company]"
       ☑ Location: "[city]"
       ☑ Education: list of degrees
     "Save selected" button (primary)
     "Skip for now" link
     Only saves fields the user has checked.

2. LinkedIn verified badge:
   In apps/web/components/ui/Badge.tsx add:
   linkedin: bg #E8F0FE, text #0A66C2, label "in Verified"
     with small LinkedIn icon inline

   Show this badge on:
   - Profile page header (if linkedin_connected = true)
   - Member list in classroom (next to name)
   - Search results (future)

3. Home page — classroom recommendations:
   After the "Active classrooms" section on home page:
   If GET /identity/linkedin/recommendations returns results:
   Show section: "Based on your LinkedIn profile"

   Each recommendation card:
   bg: white, border: 1px blue (#bfdbfe), border-radius 10px
   Left: institution icon
   Center:
     Institution name + year
     Confidence indicator:
       High: "Strong match" green pill
       Medium: "Possible match" amber pill
   Right action button:

   Type 'join' (classroom exists):
     "Join" button (primary small)
     On click: navigate to /classroom/[globalId] join flow

   Type 'create' (institution exists, no classroom):
     "Create classroom" button (ghost small)
     On click: navigate to /classroom/create
       pre-filling institution and year

   Type 'request' (institution not found):
     "Request school" button (ghost small)
     On click: opens institution request form
       pre-filling the school name from LinkedIn

   "Not me" link (small muted) on each card:
     Dismisses that specific recommendation
     Store dismissed IDs in localStorage

   If user has already joined all recommended classrooms:
     Hide this section entirely

4. Periodic sync indicator:
   On profile page LinkedIn section:
   If linkedin_synced_at is more than 30 days ago:
     Show amber dot next to "Sync now"
     Tooltip: "Your LinkedIn data may be outdated"
   Do NOT auto-sync — user must click "Sync now"

Run: npm run test — all tests pass
Run: next build
Commit: "feat: LinkedIn integration — connect, profile enrichment,
classroom recommendations, verified badge"

IMPORTANT: After pushing run in Supabase SQL Editor:
supabase/migrations/017_linkedin_profile.sql

---

## TASK 07 — Feature: dark/light theme toggle [PENDING]

Add a theme toggle so users can switch between light and dark.
Default: light theme (the mockup style).
Preference saved to localStorage.

Read apps/web/styles/globals.css

Add dark theme CSS variables:

[data-theme="dark"] {
  --color-bg:             #1a1035;
  --color-surface:        #2d1b69;
  --color-cream:          #231550;
  --color-text-primary:   #f0ecff;
  --color-text-secondary: #c4b8f0;
  --color-text-muted:     #8b7fd4;
  --color-border:         #3d2980;
  --color-border-mid:     #4a3390;
}

Apply data-theme to document.documentElement.

In apps/web/components/layout/AppShell.tsx:
Add theme toggle button in top nav (right side, next to hamburger):
  Sun icon (light theme active)
  Moon icon (dark theme active)
  On click: toggle data-theme between 'light' and 'dark'
  Save preference to localStorage: 'alumtribe_theme'

On app load (in layout.tsx or _app):
  Read localStorage 'alumtribe_theme'
  Apply immediately to avoid flash of wrong theme
  Default to 'light' if nothing saved

Auth pages: always light theme for left panel gradient
  (dark theme only affects the right panel and app pages)

Classroom header: always dark regardless of theme
  (it's intentionally dark branded)

Run: next build
Commit: "feat: light/dark theme toggle with localStorage persistence"

---

## TASK 08 — Feature: Email OTP as default MFA + TOTP as enhanced option [PENDING]

IMPORTANT: Read all existing MFA-related files before changing anything:
- apps/backend/src/modules/auth/auth.service.ts
- apps/backend/src/modules/auth/auth.controller.ts
- apps/web/app/auth/mfa/page.tsx
- apps/web/app/profile/page.tsx

Current state: TOTP (authenticator app) is the only MFA method.
This is too technical for general consumers.

New design:
- Email OTP = default method (zero friction, works for everyone)
- TOTP = optional enhanced method (for power users and admins)
- One method active at a time per user
- All flows (login, password reset, recovery) read mfa_method
  and route to the correct verification flow automatically

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART A — Database changes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create supabase/migrations/018_email_otp_mfa.sql:

-- Add mfa_method column to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS mfa_method text
  CHECK (mfa_method IN ('email', 'totp'))
  DEFAULT 'email';

-- Add email OTP table for storing temporary codes
CREATE TABLE IF NOT EXISTS public.email_otp_codes (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('login', 'password_reset', 'mfa_change')),
  expires_at   timestamptz NOT NULL,
  used         boolean NOT NULL DEFAULT false,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_otp_user_purpose_idx
  ON public.email_otp_codes(user_id, purpose, expires_at);

ALTER TABLE public.email_otp_codes ENABLE ROW LEVEL SECURITY;
-- Service role only — no user-facing RLS needed

Document: must be run manually in Supabase SQL Editor.

For existing users: set mfa_method = 'totp' where
mfa_enabled = true and mfa_totp_secret is not null.
Add this to the migration:

UPDATE public.profiles
SET mfa_method = 'totp'
WHERE mfa_enabled = true;

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART B — Backend: Email OTP service
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

In apps/backend/src/modules/auth/auth.service.ts:

Add sendEmailOtp(userId: string, purpose: string):
  Generate 6-digit numeric code (crypto.randomInt(100000, 999999))
  Hash it with SHA-256 before storing
  Store in email_otp_codes with expires_at = now + 10 minutes
  Send email via Resend:
    Subject: "Your AlumTribe verification code"
    Body: "Your code is: [CODE]\nValid for 10 minutes.\nDo not share this code."
  If Resend not configured: log to console with [EMAIL-OTP] prefix
  Return: { message: 'Code sent to your email' }
  Rate limit: max 3 codes per user per 10 minutes
    (check count of recent codes — throw if exceeded)

Add verifyEmailOtp(userId: string, code: string, purpose: string):
  Hash the incoming code
  Look up in email_otp_codes where:
    user_id matches, purpose matches, used = false,
    expires_at > now()
  If not found: throw UnauthorizedException('Invalid or expired code')
  If found: mark as used
  Return: true

Update login flow:
  After email + password verified:
  Read user's mfa_method from profiles table.

  If mfa_method = 'email':
    Call sendEmailOtp(userId, 'login')
    Return: { mfaRequired: true, mfaMethod: 'email', mfaPendingToken: ... }

  If mfa_method = 'totp':
    Return: { mfaRequired: true, mfaMethod: 'totp', mfaPendingToken: ... }
    (existing TOTP flow — no change)

Add endpoint: POST /auth/mfa/email/resend
  Auth: mfaPendingToken required
  Resend the email OTP (with rate limit check)
  Returns: { message: 'Code resent' }

Update MFA verify endpoint:
  POST /auth/mfa/verify or /auth/mfa/challenge
  If mfaMethod = 'email': call verifyEmailOtp
  If mfaMethod = 'totp': call existing TOTP verify
  Same response shape either way: { accessToken, expiresIn }

Update password reset flow:
  After requesting reset, before allowing password change:
  Read user's mfa_method.
  If mfa_method = 'email': send email OTP for 'password_reset'
  If mfa_method = 'totp': ask for TOTP code
  Verify before proceeding with password change.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART C — Frontend: MFA page updates
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/auth/mfa/page.tsx
The page already handles TOTP. Add Email OTP handling.

Read mfaMethod from sessionStorage (set during login).

If mfaMethod = 'email':
  Show:
    Email icon (ti-mail, brand primary, 32px) centered
    "Check your email" heading (bold 20px)
    "We sent a 6-digit code to [email]" (muted 14px)
    Email address shown partially masked: "te***@yopmail.com"

    Six individual digit input boxes (same as TOTP UI)
    Auto-focus first box, auto-advance on each digit entry
    Auto-submit when all 6 digits entered

    "Verify" button (primary, full width)

    Resend section (below button):
      First 60 seconds: "Resend code in [N]s" (muted, disabled)
      After 60 seconds: "Didn't receive it? Resend code" (link)
      On resend click: POST /auth/mfa/email/resend
      Show success: "Code resent to your email"
      Reset 60s countdown

    "Having trouble? Sign in again" link → /auth/login

If mfaMethod = 'totp':
  Existing UI unchanged:
    "Open your authenticator app" instruction
    Six digit boxes
    No resend option (TOTP generates its own codes)
    "Lost access to your authenticator?" recovery link

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART D — Registration: default Email OTP + TOTP banner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/auth/mfa/page.tsx (setup flow)
Read apps/web/app/onboarding/page.tsx if it exists

When a new user signs up and hits MFA setup for the first time:

Show TWO options clearly:

Option 1 — Email OTP (recommended, default):
  Card (white, border, selected state = brand primary border):
    ✉️ icon (brand primary)
    "Email verification" (bold 14px)
    "We'll send a code to your email each time you sign in"
    "Recommended for most users" green pill
    Selected by default

Option 2 — Authenticator App (enhanced):
  Card (white, border):
    🔐 icon
    "Authenticator App" (bold 14px)
    "Use Google Authenticator or similar app"
    "More secure" blue pill
    If user is admin: show amber banner inside card:
    "⚠️ Recommended for admins — you have access to
     member data and verification controls."

"Continue" button below cards (primary, full width)

On selecting Email OTP and continuing:
  Set mfa_method = 'email' in profiles
  mfa_enabled = true
  Send a test OTP to verify email works
  Show success: "Email verification is set up. 
  You'll receive a code each time you sign in."
  Redirect to / or onboarding

On selecting TOTP and continuing:
  Show existing QR code setup flow (unchanged)
  After successful TOTP verification:
    Set mfa_method = 'totp'
    mfa_enabled = true

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART E — Profile: MFA management section
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read apps/web/app/profile/page.tsx

Replace the current "Reset authenticator" row with a full
MFA management section:

Section heading: "TWO-FACTOR AUTHENTICATION"

Current method card (white, green border):
  Shows active method with green "Active" badge
  Email OTP card: ✉️ + "Email verification" + "Active"
  TOTP card: 🔐 + "Authenticator App" + "Active"

Switch method section:
  Shows the OTHER method (not currently active)
  With "Switch to this method" button (ghost)

  Switching from Email to TOTP:
    "Switch to Authenticator App"
    On click: start TOTP setup flow (QR code)
    After verification: update mfa_method = 'totp'
    Show success: "Authenticator app is now your 
    sign-in method."

  Switching from TOTP to Email:
    "Switch to Email verification"
    Confirm dialog: "This will remove your authenticator
    app setup. Are you sure?"
    On confirm: verify with current TOTP code first
    Then: clear mfa_totp_secret, set mfa_method = 'email'
    Show success: "Email verification is now your 
    sign-in method."

For admin users — extra nudge card below:
  Amber bg (#fef9c3), amber border
  "🔒 You're a classroom admin"
  "Authenticator apps are more secure for admins
   who manage member data and verifications."
  Only show if current method is 'email'
  "Set up Authenticator App →" link
  Dismiss X (store in localStorage, don't show again)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART F — Unit tests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add unit tests for new email OTP service methods:
- sendEmailOtp generates and stores a hashed code
- sendEmailOtp rate-limits after 3 codes in 10 minutes
- verifyEmailOtp succeeds with correct code
- verifyEmailOtp fails with wrong code
- verifyEmailOtp fails with expired code
- verifyEmailOtp fails with already-used code
- Login with mfa_method='email' triggers sendEmailOtp
- Login with mfa_method='totp' skips sendEmailOtp

Run: npm run test — all tests must pass including new ones
Run: next build — 0 errors
Commit: "feat: email OTP as default MFA, TOTP as enhanced option,
MFA method selection on registration, MFA management in profile"

IMPORTANT: After pushing run in Supabase SQL Editor:
supabase/migrations/018_email_otp_mfa.sql

---

## TASK 09 — Fix: signup "something went wrong" [PENDING]

Live bug — real users cannot sign up.

Read apps/web/app/auth/signup/page.tsx
Read apps/backend/src/modules/auth/auth.service.ts

Check the signup API call shape:
POST /v1/auth/signup
Body must be: { email, password, fullName }

Fix 1 — Field name mismatch:
Confirm the frontend sends 'fullName' not 'full_name' or 'name'.
Confirm the backend DTO expects 'fullName'.
If mismatched — fix whichever side is wrong.

Fix 2 — Frontend error handling:
Replace generic "something went wrong" with specific messages:
  409 → "An account with this email already exists.
          Sign in instead?" with link to /auth/login
  400 → parse validation error array, show per field
  500 → "Server error. Please try again in a moment."
  Network → "Connection issue. Check your internet."

Wrap entire form submit in try/catch.
Never show raw error objects to users.

Fix 3 — Add error logging:
console.error('[SIGNUP-ERROR]', {
  status: error?.status,
  message: error?.message,
  body: error?.body
})

Run: npm run test and next build
Commit: "fix: signup error handling and field name validation"

---

## TASK 10 — Fix: MFA setup 400 on new signups [PENDING]

Live bug — new users cannot complete MFA setup.
GET /v1/auth/mfa/setup returns 400
"Failed to start MFA setup. Please try again."

Read apps/backend/src/modules/auth/auth.service.ts
Find initiateTotpSetup() or getMfaSetup().

Fix 1 — Check Supabase client type:
The method must use the SERVICE ROLE client not anon client.
Service role bypasses RLS.
If using anon client — switch to service role client.

Fix 2 — Add detailed error logging:
console.error('[MFA-SETUP-ERROR]', {
  userId,
  error: error?.message,
  code: error?.code,
  details: error?.details,
  hint: error?.hint
})
This will show the real error in Render logs.

Fix 3 — Verify RLS policy:
Run this in Supabase SQL Editor to check current policies:
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'mfa_totp_secrets';

If insert policy is missing or wrong — fix it:
DROP POLICY IF EXISTS "mfa_totp_secrets_insert_own"
  ON public.mfa_totp_secrets;
CREATE POLICY "mfa_totp_secrets_insert_own"
  ON public.mfa_totp_secrets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

Add the corrected policy to a new migration file:
supabase/migrations/019_fix_mfa_totp_rls.sql
Document: must be run manually in Supabase SQL Editor.

Run: npm run test and next build
Commit: "fix: MFA setup 400 — service role client and RLS policy"

---

## TASK 11 — Feature: structured logging with log levels [PENDING]

Implement proper structured logging across the entire backend.
Current state: raw console.log scattered everywhere with
no consistency, no levels, no masking of sensitive data.

LOG_LEVEL env var controls verbosity:
  debug — all logs including request details (use now)
  info  — business events only (use at launch)
  warn  — warnings and errors only
  error — errors only (production incidents)

STEP 1 — Create logger service:
Create apps/backend/src/common/logger/logger.service.ts:

import { Injectable } from '@nestjs/common'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

@Injectable()
export class AppLogger {
  private context?: string
  private readonly level: LogLevel

  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || 'info'
  }

  setContext(context: string): this {
    this.context = context
    return this
  }

  private shouldLog(level: LogLevel): boolean {
    const order: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return order.indexOf(level) >= order.indexOf(this.level)
  }

  private format(level: string, message: string, meta?: object): string {
    const ts  = new Date().toISOString()
    const ctx = this.context ? `[${this.context}]` : ''
    const m   = meta ? ' ' + JSON.stringify(meta) : ''
    return `${ts} ${level.toUpperCase().padEnd(5)} ${ctx} ${message}${m}`
  }

  debug(message: string, meta?: object) {
    if (this.shouldLog('debug')) console.log(this.format('debug', message, meta))
  }
  info(message: string, meta?: object) {
    if (this.shouldLog('info'))  console.log(this.format('info',  message, meta))
  }
  warn(message: string, meta?: object) {
    if (this.shouldLog('warn'))  console.warn(this.format('warn', message, meta))
  }
  error(message: string, meta?: object) {
    if (this.shouldLog('error')) console.error(this.format('error', message, meta))
  }

  // Email masking helper
  static maskEmail(email: string): string {
    const [user, domain] = (email || '').split('@')
    if (!domain) return '***'
    return user.slice(0, 2) + '***@' + domain
  }
}

Create apps/backend/src/common/logger/logger.module.ts:
Register AppLogger as a global provider so it can be
injected into any service without importing the module.

STEP 2 — Wire up to NestJS:
In apps/backend/src/main.ts:
  const logger = app.get(AppLogger)
  app.useLogger({
    log: (msg) => logger.info(msg),
    error: (msg, trace) => logger.error(msg, { trace }),
    warn: (msg) => logger.warn(msg),
    debug: (msg) => logger.debug(msg),
    verbose: (msg) => logger.debug(msg),
  })

STEP 3 — Add LOG_LEVEL to environment:
apps/backend/.env:
  LOG_LEVEL=debug

apps/backend/.env.example:
  # Log level: debug | info | warn | error
  # debug = development, info = production
  LOG_LEVEL=info

Add to Render env vars comment in docs/ENVIRONMENT.md:
  LOG_LEVEL | debug | Change to 'info' before public launch

STEP 4 — Add structured logging to every service:
Inject AppLogger into each service constructor.
Replace all raw console.log/error calls.

NEVER log in production:
- Full passwords
- Full JWT tokens
- Full credit card numbers (N/A here but good practice)
Always mask emails using AppLogger.maskEmail()

auth.service.ts — add logs:
  debug: '[AUTH] Login attempt' { email: masked }
  info:  '[AUTH] Login success' { userId, mfaMethod }
  error: '[AUTH] Login failed' { email: masked, reason }
  info:  '[AUTH] Signup' { email: masked }
  error: '[AUTH] Signup failed' { email: masked, error }
  info:  '[AUTH] MFA setup initiated' { userId }
  error: '[AUTH] MFA setup failed' { userId, code, hint }
  info:  '[AUTH] MFA verified' { userId, method }
  error: '[AUTH] MFA verify failed' { userId, reason }
  info:  '[AUTH] Password reset requested' { email: masked }
  info:  '[AUTH] Password changed' { userId }
  info:  '[AUTH] Logout' { userId }
  info:  '[AUTH] Session created' { userId }

corridor.service.ts:
  debug: '[CORRIDOR] Fetch messages' { classroomId, channel, userId }
  error: '[CORRIDOR] Fetch failed' { classroomId, channel, error }
  debug: '[CORRIDOR] Send message' { classroomId, channel, userId }
  error: '[CORRIDOR] Send failed' { error }
  warn:  '[CORRIDOR] Access denied' { userId, classroomId, channel, role }

classroom.service.ts:
  info:  '[CLASSROOM] Created' { globalId, userId }
  error: '[CLASSROOM] Creation failed' { error }
  debug: '[CLASSROOM] Fetch members' { classroomId }
  error: '[CLASSROOM] Members failed' { classroomId, error }

identity.service.ts:
  debug: '[IDENTITY] Profile fetch' { userId }
  error: '[IDENTITY] Profile fetch failed' { userId, error }
  info:  '[IDENTITY] Profile updated' { userId, fields: Object.keys(dto) }

dm.service.ts:
  debug: '[DM] Fetch conversations' { userId }
  error: '[DM] Fetch failed' { userId, error }
  info:  '[DM] Message sent' { senderId, recipientId }
  error: '[DM] Send failed' { error }
  warn:  '[DM] Access denied - no shared classroom' { senderId, recipientId }

institution.service.ts:
  info:  '[INSTITUTION] Request submitted' { name, type, userId }
  info:  '[INSTITUTION] Approved' { name, slug }
  info:  '[INSTITUTION] Rejected' { requestId, reason }
  debug: '[INSTITUTION] Search' { query, count }

membership.service.ts:
  info:  '[MEMBERSHIP] Joined' { userId, classroomId, role }
  info:  '[MEMBERSHIP] Verified' { userId, classroomId, method }
  warn:  '[MEMBERSHIP] Verification rejected' { userId, classroomId }

verification.service.ts:
  info:  '[VERIFY] Document submitted' { userId, classroomId }
  info:  '[VERIFY] Vouch added' { voucherId, voucheeId, classroomId }
  info:  '[VERIFY] Email domain matched' { userId, classroomId }
  warn:  '[VERIFY] LinkedIn no match' { userId, classroomId }

audit.service.ts:
  debug: '[AUDIT] Event recorded' { actor, action, resource }
  error: '[AUDIT] Record failed' { error }

STEP 5 — Add logging docs:
Add to docs/DEVELOPMENT.md:

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

Run: npm run test — all tests must pass
Run: next build — 0 errors
Commit: "feat: structured logging with log levels,
masked emails, context tags across all services"
Push.

---

## COMPLETION SUMMARY

(Claude Code fills this in when all tasks are [DONE])

Date completed:
Tasks completed:
Tests passing:
Build status:
Migrations to run manually in Supabase:
  - 016_institution_logos.sql (TASK 05)
  - 017_linkedin_profile.sql (TASK 06)
Notes:

---

## RESUMPTION GUIDE

Paste this to resume after any interruption:

"Read TASKS_05.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
