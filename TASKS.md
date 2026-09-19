# AlumTribe — Web Stabilization Tasks

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done under the task heading
  - Commit the updated TASKS.md along with the code changes
- If a task fails, change [PENDING] to [FAILED: reason] and STOP
- Do not move to the next task until the current one fully passes
- Run `npm run test` after every task — 271/271 must pass
- Run `next build` after any frontend task before committing
- All commits go to main

If you are resuming after an interruption:
- Read this file first
- Find the first task that is still [PENDING]
- Start from there

---

## TASK 00 — TOTP clock skew fix [DONE]

window: 1 already existed in auth.service.ts (present since the auth
module's very first commit, ca45e6b — not a new regression). Widened to
window: 2 (±60s instead of ±30s) since the report says codes were still
rejected, which a ±30s window wouldn't cover if actual drift exceeds
that. Added a test proving a 60s-drifted code is now accepted and a
120s-drifted one is still rejected. If codes are still rejected after
this ships, the step-window isn't the real cause — check the actual
server clock (Render instance) and whether PingID uses a non-default
TOTP step/digit count, since speakeasy assumes RFC 6238 defaults on
both ends (see the new comment at the verify call site).

BLOCKING — user cannot log in. Fresh TOTP codes from PingID
are rejected with AUTH_MFA_INVALID_CODE even when entered
immediately. This is a server clock drift issue, not a user error.

Fix: add a time window tolerance of 1 step to TOTP verification.
This is standard practice per RFC 6238.

Steps:

1. Open apps/backend/src/modules/auth/auth.service.ts
   Find the TOTP verification logic (look for otplib or speakeasy)

   If using otplib:
   import { authenticator } from 'otplib'
   Add before verification: authenticator.options = { window: 1 }
   Or pass options inline:
   authenticator.verify({ token: code, secret: secret, window: 1 })

   If using speakeasy:
   speakeasy.totp.verify({
     secret: secret,
     encoding: 'base32',
     token: code,
     window: 1
   })

   window: 1 accepts codes from:
   - 30 seconds ago (previous window)
   - current 30-second window
   - 30 seconds ahead (next window)
   This is safe and is what Google, GitHub, and all major
   services use to handle clock drift.

2. Also check apps/backend/src/modules/auth/auth.service.spec.ts
   Update any TOTP tests that mock time to account for window: 1

Run: npm run test — 271/271 must pass
Commit: "fix: TOTP window tolerance for clock skew (window: 1)"
Push immediately — this is blocking login.

---

## TASK 00A — Wordmark cleanup and auth panel layout fix [DONE]

Wordmark: replaced with the plain-text version (no cap/SVG), using
your exact code with one swap (var(--color-primary) instead of the
literal hex for the light variant, since that token already exists).
AuthLayout: 60/40 desktop split (55/45 tablet), carousel/animation
state removed entirely (no useState/useEffect/setInterval, no dots),
all three feature cards always stacked and visible, card layout
changed to icon-left/text-right per the new spec. Removed the now-
orphaned dotsLabel/dotLabel i18n keys. next build passes (17 routes).

Two visual fixes on the auth screens (login, signup, MFA, forgot-password,
reset-password). Both are visible in production right now.

---

FIX 1 — Remove the graduation cap from the Wordmark

The cap is floating above the wrong letter and looks broken.
Remove it entirely. Just render the plain serif wordmark text.

Open apps/web/components/Wordmark.tsx

Replace the entire component with this clean version:

'use client'

interface WordmarkProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'light' | 'dark'
}

const sizes = {
  sm: 20,
  md: 28,
  lg: 40,
  xl: 56,
}

export default function Wordmark({
  size = 'md',
  variant = 'light',
}: WordmarkProps) {
  const fontSize = sizes[size]
  const color = variant === 'dark' ? '#ffffff' : '#4A1FA8'

  return (
    <span
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize,
        fontWeight: 700,
        color,
        letterSpacing: '0.01em',
        lineHeight: 1,
        userSelect: 'none',
        display: 'inline-block',
      }}
    >
      AlumTribe
    </span>
  )
}

No SVG, no cap, no positioning tricks. Just the wordmark text.
The cap concept is reserved for when a professional designer
can implement it properly in Figma.

---

FIX 2 — Auth left panel layout: 60/40 split, three stacked cards

Currently: ~75% left panel with one small rotating card, large empty space.
Fix: 60/40 split, all three feature cards stacked vertically, no carousel.

Open apps/web/components/layout/AuthLayout.tsx

Changes:

1. Split ratio:
   Left panel: flex: 3 (60%)
   Right panel: flex: 2 (40%), min-width: 380px
   Tablet (768-1024px): 55/45
   Mobile (<768px): unchanged (stacked, compact header)

2. Remove the carousel/animation entirely:
   No auto-rotating cards, no dot indicators, no fade transitions.
   All three cards visible at the same time, stacked vertically.
   This fills the left panel naturally with no empty space.

3. Card layout (three cards stacked with gap between them):

   Card 1 — Private and verified
   Icon: shield (ti-shield-check, white, 24px)
   Title: "Private and verified" (white, 15px, font-weight 600)
   Body: "Every member verified before they can post.
          Your batch stays trusted." (white 65% opacity, 13px)

   Card 2 — Three private channels
   Icon: ti-messages (white, 24px)
   Title: "Three private channels"
   Body: "Classroom, Staff Room, and Student Alley.
          Each with its own privacy rules."

   Card 3 — Your batch, forever
   Icon: ti-heart (white, 24px)
   Title: "Your batch, forever"
   Body: "Reunions, memories, and real connections.
          Long after graduation."

   Card styling:
   background: rgba(255,255,255,0.1)
   border: 1px solid rgba(255,255,255,0.18)
   border-radius: 14px
   padding: 16px 20px
   display: flex, gap: 14px (icon left, text right)

4. Layout order top to bottom in left panel:
   - Wordmark (top-left, size md, variant dark)
   - Tagline (large italic, center of panel)
   - Sub-tagline (muted white, smaller)
   - Three stacked cards
   - Stat pills row (bottom)

5. Remove all animation/carousel JS (useState for activeCard,
   useEffect for interval, dot click handlers).
   This simplifies the component significantly.

Run: next build
Commit: "fix: remove cap from wordmark, 60/40 auth panel, stacked cards"

---

## TASK 01 — Logout button [DONE]

AppShell.tsx has no top nav bar to add a dropdown to — it renders no
header content by design (its own doc comment: every screen's header
differs too much to templatize there), and every screen with an
avatar already builds its own top bar locally. Built a reusable
UserMenu component instead (avatar trigger + dropdown: View profile,
Switch persona [preserves what the avatar used to link straight to],
Help & Support, Sign out) and wired it into home and teacher home's
top bars, replacing their plain avatar links. Reused AuthProvider's
existing logout() (added ?message=signed_out to its redirect) instead
of a new lib/auth.ts signOut() helper — it already did everything
step 2 asked for. Login page's signed_out banner and profile page's
own Sign out button (with confirmation modal) already existed from
an earlier session — no changes needed there. Help & Support links to
/contact, which doesn't exist until TASK 07 later in this run.

Backend endpoint already exists: POST /v1/auth/logout
It invalidates the session. The UI just needs to call it.

Steps:

1. Open apps/web/components/layout/AppShell.tsx
   Find the avatar/profile area in the top nav bar
   Add a dropdown menu triggered by clicking the avatar:
     - "View profile" → /profile
     - "Help & Support" → /contact
     - divider
     - "Sign out" (destructive/red text)

2. Sign out logic (create a shared signOut() helper in lib/auth.ts):
   - Call POST /v1/auth/logout via api.logout()
   - Call clearSession() to wipe local token and user
   - If API call fails: still clear local session (silent fail)
   - Redirect to /auth/login?message=signed_out

3. Open apps/web/app/auth/login/page.tsx
   Add handling for ?message=signed_out in URL params:
   Show a blue info banner at top: "You have been signed out."
   Clear the param from URL after showing (router.replace)

4. Open apps/web/app/profile/page.tsx
   Add a "Sign out" button at the bottom of the page
   Ghost style with red/destructive text
   Same signOut() helper from step 2

Run: npm run test and next build
Commit: "feat: logout — nav dropdown and profile page button"

---

## TASK 02 — Google OAuth callback page [DONE]

Built in commit 4431ee4. Page exists at /auth/callback.
Note: backend sends expiresIn (seconds) not expiresAt —
the callback page converts this correctly.

---

## TASK 03 — Forgot and reset password backend [DONE]

Migration numbered 009 (006 was already taken by notification_module
— task text was stale). Added POST /auth/forgot-password and
POST /auth/reset-password, both DTOs, and a Resend email integration
(the `resend` package was already a dependency but unused anywhere —
this is its first real usage). Reset link uses FRONTEND_URL, not a
hardcoded alumtribe.com — same reasoning as the Google OAuth callback
redirect (localhost in dev, alumtribe.com in prod, one env var).
Added AuditEventType.AUTH_PASSWORD_RESET_REQUESTED (new) — reused the
existing but previously-unused AUTH_PASSWORD_CHANGED for the actual
reset, and the existing session-revocation pattern from
logout({allDevices}) with a new 'password_reset' reason. Updated the
frontend's forgot/reset-password pages: their 404-treated-as-success
fallback stays (cheap insurance) but the "not built yet" comments are
now inaccurate and were corrected. 6 new backend tests, 278/278 total.

The UI pages for forgot/reset password were built but the
backend endpoints don't exist. Build them now.

Steps:

1. Create migration: supabase/migrations/006_password_reset.sql

   CREATE TABLE public.password_reset_tokens (
     id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
     user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
     token_hash text NOT NULL,
     expires_at timestamptz NOT NULL,
     used boolean DEFAULT false,
     used_at timestamptz,
     created_at timestamptz DEFAULT now()
   );
   ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
   -- Only service role can read/write (no user-facing RLS needed)

2. In apps/backend/src/modules/auth/auth.controller.ts
   Add: POST /auth/forgot-password
   Add: POST /auth/reset-password

3. In apps/backend/src/modules/auth/auth.service.ts
   Add: forgotPassword(email: string)
   - Look up profile by email (use service role client)
   - If not found: return silently (never reveal if email exists)
   - Generate token: 32 random bytes as hex string
   - Store SHA-256 hash in password_reset_tokens (expires 1 hour)
   - Send email via Resend if RESEND_API_KEY is set
     Subject: "Reset your AlumTribe password"
     Body: plain text with link:
       https://alumtribe.com/auth/reset-password?token=[raw_token]
   - If Resend not configured: log to console with prefix [DEV]
   - Audit log: auth.password.reset_requested (actor = system)
   - Always return: { message: 'If that email exists a reset link was sent' }

   Add: resetPassword(token: string, newPassword: string)
   - Hash the incoming token with SHA-256
   - Look up in password_reset_tokens where token_hash matches
   - If not found: throw BadRequestException('Invalid or expired link')
   - If expires_at < now(): throw BadRequestException('Link has expired')
   - If used = true: throw BadRequestException('Link already used')
   - Validate password min 8 chars
   - Update password in Supabase Auth via admin client
   - Mark token as used (used = true, used_at = now())
   - Invalidate all existing sessions for this user in the sessions table
   - Audit log: auth.password.changed
   - Return: { message: 'Password reset successfully' }

4. Add DTOs:
   ForgotPasswordDto: { email: string (IsEmail) }
   ResetPasswordDto: { token: string, password: string (MinLength 8) }

5. Add unit tests for both methods in auth.service.spec.ts

Run: npm run test — all tests must pass including new ones
Commit: "feat: forgot password and reset password backend endpoints"

---

## TASK 04 — Node 22 upgrade [DONE]

Done in commit 7e94f7b.
.node-version set to 22, .nvmrc set to 22, engines.node bumped
to >=22.0.0 in root package.json.
Note: realtime: { enabled: false } was NOT applied — that option
does not exist in the installed Supabase SDK. Node 22 itself
provides the native WebSocket that Supabase Realtime needs.
Warning: .node-version may be reverting to UTF-16 encoding on
Windows — worth checking in Render logs after next deploy.

---

## TASK 05 — FRONTEND_URL config and docs [DONE]

Steps 1 and 2 (FRONTEND_URL in the controller + comment,
.env.example entry) were already done in an earlier commit
(4431ee4). Only step 3 was outstanding — created docs/ENVIRONMENT.md
with the exact content specified. No code changes, no build/test run.

Steps:

1. Verify apps/backend/src/modules/auth/auth.controller.ts
   already has FRONTEND_URL in the Google callback handler.
   If missing add it now with default 'http://localhost:3000'.

2. Update apps/backend/.env.example:
   Add: FRONTEND_URL=http://localhost:3000
   With comment: # Required for Google OAuth redirect in production
                 # Set to https://alumtribe.com in Render env vars

3. Create docs/ENVIRONMENT.md with this exact content:

# Environment Variables Reference

## Backend (alumini service on Render)

| Variable | Production value | Notes |
|---|---|---|
| NODE_ENV | production | |
| SUPABASE_URL | https://forkamymzckhwkaqegnn.supabase.co | |
| SUPABASE_ANON_KEY | sb_publishable_... | Safe to expose |
| SUPABASE_SERVICE_ROLE_KEY | sb_secret_... | Never expose publicly |
| JWT_SECRET | (random 32+ chars) | |
| JWT_EXPIRY | 7d | |
| MFA_ISSUER | AlumTribe | Shown in authenticator app |
| GOOGLE_CLIENT_ID | (from Google Cloud Console) | |
| GOOGLE_CLIENT_SECRET | (from Google Cloud Console) | |
| GOOGLE_CALLBACK_URL | https://api.alumtribe.com/v1/auth/google/callback | |
| FRONTEND_URL | https://alumtribe.com | REQUIRED — Google OAuth redirect |
| CORS_ORIGINS | https://alumtribe.com,https://www.alumtribe.com | |
| APP_URL | https://api.alumtribe.com | |
| RESEND_API_KEY | (from resend.com) | Optional — logs to console if missing |
| FROM_EMAIL | noreply@alumtribe.com | Must be verified in Resend |

## Web (alumini-web service on Render)

| Variable | Production value | Notes |
|---|---|---|
| NEXT_PUBLIC_API_URL | https://api.alumtribe.com/v1 | |
| NEXT_PUBLIC_SUPABASE_URL | https://forkamymzckhwkaqegnn.supabase.co | |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | sb_publishable_... | |
| NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED | true | |
| HOSTNAME | 0.0.0.0 | Required for Render proxy |
| NODE_ENV | production | |
| PORT | 3000 | |

## Pending setup (not yet configured)

| What | Where | Notes |
|---|---|---|
| RESEND_API_KEY | resend.com | Free tier: 3000 emails/month |
| Zoho Mail MX records | Cloudflare DNS | For hello@alumtribe.com mailbox |
| Firebase FCM | firebase.google.com | Push notifications — mobile P1 |

## Node version

Both services require Node 22+.
Controlled by .node-version in project root.
Warning: on Windows, this file may save as UTF-16.
If Render picks up wrong Node version, check file encoding.

Commit: "docs: environment variables reference"

---

## TASK 06 — Privacy Policy and Terms of Service pages [DONE]

Built a shared StaticPageLayout component (Wordmark sm + back link,
centered 720px column, optional footer links) since privacy/terms/
contact all share the same shell. Terms reuses privacy's own
page.module.css directly (identical styling, no point duplicating
the file). Signup page now has the terms/privacy agreement line
below the submit button (plain Link, no target="_blank" — "open in
same tab" per spec). Login page footer now has Terms | Privacy |
Contact. next build passes (19 routes, /privacy and /terms new).

Legally required before real users sign up.

Steps:

1. Create apps/web/app/privacy/page.tsx
   No auth required — publicly accessible
   Centered column, max-width 720px, generous padding

   Header: Wordmark (size sm) + "← Back to home" link

   Heading: "Privacy Policy"
   Subheading: "Last updated: September 2026"

   Section 1 - What we collect:
   Name, email address, profile photo (from Google if you use
   Google sign-in), classroom memberships, messages you send,
   and verification documents (auto-deleted after 30 days).

   Section 2 - How we use it:
   To connect you with your alumni network and verify your
   membership in classrooms. We never use your data for advertising.

   Section 3 - What we never do:
   We never sell your personal data. We never show ads.
   We never share your data with third parties except to
   operate the service (Supabase for database, Google for sign-in).

   Section 4 - How we protect it:
   All data is encrypted in transit and at rest. Row-level
   security means you only see data you are permitted to see.
   Verification documents are automatically deleted after 30 days.

   Section 5 - Your rights:
   You can request a copy of your data, correct it, or delete
   your account at any time. Email hello@alumtribe.com.

   Section 6 - Contact:
   hello@alumtribe.com | alumtribe.com

   Footer links: Terms of Service | Contact

2. Create apps/web/app/terms/page.tsx
   Same layout as privacy page.

   Heading: "Terms of Service"
   Subheading: "Last updated: September 2026"

   Section 1 - What AlumTribe is:
   A private verified network for school and college alumni.

   Section 2 - Who can use it:
   You must be a genuine alumni, student, or teacher of the
   institution you are joining. Fake accounts or joining
   classrooms you were not part of is not allowed.

   Section 3 - Verification:
   We require verification before you can post. Providing false
   verification documents is grounds for permanent removal.

   Section 4 - Conduct:
   No spam, harassment, hate speech, or illegal content.
   Keep conversations respectful. Admins can remove content
   and suspend accounts that violate these rules.

   Section 5 - Our rights:
   We can remove content or suspend accounts that violate
   these terms. We will always try to notify you first.

   Section 6 - Limitation of liability:
   AlumTribe is provided as-is. We are not liable for content
   posted by users.

   Section 7 - Contact:
   hello@alumtribe.com

   Footer links: Privacy Policy | Contact

3. In apps/web/app/auth/signup/page.tsx
   Below the sign up button add:
   "By creating an account you agree to our
   [Terms of Service] and [Privacy Policy]"
   Both are links, open in same tab, small muted text

4. In apps/web/app/auth/login/page.tsx
   Footer: add small links — Terms | Privacy | Contact

5. Add strings to apps/web/i18n/messages/en.json

Run: next build
Commit: "feat: privacy policy and terms of service pages"

---

## TASK 07 — Contact and support page [DONE]

Built on StaticPageLayout from TASK 06. Privacy/terms pages already
link to /contact in their footers (added proactively in TASK 06).
UserMenu.tsx already had "Help & Support" → /contact positioned
above the divider, before Sign out (TASK 01) — no AppShell.tsx change
needed since that dropdown lives in UserMenu, not AppShell (see TASK
01's note for why). next build passes (20 routes, /contact new).

Steps:

1. Create apps/web/app/contact/page.tsx
   No auth required — publicly accessible
   Same layout as /privacy and /terms

   Header: Wordmark (size sm) + "← Back to home" link

   Heading: "Contact us"
   Subheading: "We'd love to hear from you"

   Three sections as cards:

   General enquiries:
   Label: "General"
   Email: hello@alumtribe.com
   Description: "Questions about AlumTribe, partnerships, or anything else."
   Link: mailto:hello@alumtribe.com

   Support:
   Label: "Support"
   Email: hello@alumtribe.com
   Description: "Having trouble? We respond within 24 hours."
   Link: mailto:hello@alumtribe.com?subject=Support%20request

   Report a problem:
   Label: "Report a problem"
   Email: hello@alumtribe.com
   Description: "To report abusive content or a technical issue."
   Link: mailto:hello@alumtribe.com?subject=Report%3A%20

   Note at bottom (small, muted):
   "All three reach the same inbox for now. We aim to respond within 24 hours."

   Footer links: Privacy Policy | Terms of Service

2. Add "Contact" link to footer of /privacy and /terms pages

3. Add contact page strings to apps/web/i18n/messages/en.json

Run: next build
Commit: "feat: contact and support page"

---

## TASK 08 — 404 and error pages [DONE]

Both built as specified. error.tsx sits at the app root — per Next.js's
error-boundary convention it wraps everything below the root layout,
so layout.tsx's providers (including next-intl's) stay intact and
useTranslations() works inside it; only a crash in the root layout
itself would bypass it (that's global-error.tsx's job, out of scope
here). next build passes (20 routes + the not-found/error boundaries,
which don't show as routes themselves).

Steps:

1. Create apps/web/app/not-found.tsx
   No auth required

   Layout: full height centered, brand purple background (#2D1B69)

   Content:
   - Wordmark (size lg, variant dark) at top
   - Large "404" (white, 96px, Georgia serif)
   - "Page not found" (white, 24px)
   - "The page you're looking for doesn't exist." (white 70%, 16px)
   - "Go home" button (white bg, primary text) → /

2. Create apps/web/app/error.tsx
   Must have 'use client' at top — Next.js requirement

   Props: { error: Error, reset: () => void }

   Layout: full height centered, light background

   Content:
   - Wordmark (size md)
   - "Something went wrong" heading
   - "We hit an unexpected error. Please try again." (muted)
   - "Try again" button (primary) → calls reset()
   - "Go home" link → /

Run: next build
Commit: "feat: 404 and error boundary pages"

---

## TASK 09 — Loading states and error handling audit [DONE]

Audited all 8 pages plus their real data-fetching sub-components
(admin's 5 tabs, teacher's StudentSearchModal). No code changes —
everything already passed on all four criteria:
- Loading: every page uses LoadingSpinner/SkeletonCard, never a blank
  screen (both components already existed, built in the app's very
  first phase — nothing to create).
- Error: every catch block routes through getErrorMessage(); grepped
  all 8 pages + sub-components for direct err.message/error.message
  access (the raw-leak anti-pattern) and found zero instances.
- Empty: EmptyState is used everywhere a list can genuinely be empty
  (home, profile, teacher, admin tabs, student search). Pages with no
  EmptyState (classroom/create, classroom/[globalId], verify, persona)
  don't have a "list that can be empty" to begin with — a create
  form, a chat view, a fixed 6-method list, and a persona list that's
  never empty (the viewer always has at least their own persona).
- Form timeout: no page has an explicit 30s submit timeout, but
  lib/api.ts's request() already aborts every call at 10s
  (REQUEST_TIMEOUT_MS) via AbortController, which is stricter than
  what was asked and already guarantees no button stays loading
  forever.
No build/test run — nothing changed.

Every page that fetches data must show a loading state
and handle errors gracefully.

For each page in apps/web/app/:
  / (home)
  /classroom/create
  /classroom/[globalId]
  /verify
  /profile
  /persona
  /teacher
  /admin

Check and fix all three states on each page:

1. Loading state:
   Show a spinner or skeleton while data is being fetched.
   Never show a blank white screen.
   Use <LoadingSpinner /> centered in the content area.

2. Error state:
   If the API call fails show a friendly message.
   Pattern: "Unable to load [content]. Please try again." + Retry button.
   Never show raw error objects or "undefined".

3. Empty state:
   If API returns empty data show a helpful message with a CTA.
   Home page example: "You haven't joined any classrooms yet. [Find your batch →]"

4. Form buttons:
   Every submit button must show a spinner while submitting.
   Disable the button while submitting (prevents double submit).
   Show inline error below form if submission fails.
   Timeout after 30 seconds — never stay loading forever.

Create if missing:
   apps/web/components/ui/LoadingSpinner.tsx
     Props: size? ('sm' | 'md' | 'lg'), className?
     Simple CSS animation using brand primary color

   apps/web/components/ui/EmptyState.tsx
     Props: title, description, ctaLabel?, ctaHref?
     Centered layout with muted icon area

Run: next build
Commit: "fix: loading, error, and empty states across all pages"

---

## TASK 10 — AppShell nav bar completeness [PENDING]

Review the main app navigation and make sure it works
end to end for a logged-in user.

Steps:

1. Open apps/web/components/layout/AppShell.tsx
   Confirm these nav items exist and route correctly:
   - Home (/) — classroom list
   - Create classroom (/classroom/create)
   - Profile (/profile)
   - Persona switcher (/persona) — show only if user has 2+ personas
   - Teacher view (/teacher) — show only if user has teacher persona
   - Admin (/admin) — show only if user has admin persona

2. Nav bar must show:
   - AlumTribe Wordmark (size sm) top-left, links to /
   - User avatar top-right — shows initials if no avatar URL
   - Dropdown on avatar click (from TASK 01): View profile,
     Help & Support, divider, Sign out
   - Active route highlighted

3. Mobile (below 768px):
   - Bottom tab bar: Home, Classes, Messages (placeholder), Profile
   - Icons only or icons with small labels
   - Safe area aware (bottom padding for iPhone home bar)

4. Nav reads from auth state — not hardcoded
   Show actual user name and avatar from getCurrentUser()

Run: next build
Commit: "fix: AppShell nav bar — routing, persona-aware items, mobile tabs"

---

## TASK 11 — Final check and summary [PENDING]

Steps:

1. Run npm run test — must show 271/271 passing
2. Run next build — must complete with 0 errors
3. Run npx tsc --noEmit in apps/web — must show 0 type errors
4. Confirm all these routes render without crashing:
   /auth/login
   /auth/signup
   /auth/mfa
   /auth/forgot-password
   /auth/reset-password
   /auth/callback
   /privacy
   /terms
   /contact
   / (redirects to /auth/login if not logged in — correct)

5. Mark this task [DONE] and fill in the summary below.

---

## COMPLETION SUMMARY

(Claude Code fills this in when TASK 11 is marked [DONE])

Date completed:
Tasks completed:
Tasks skipped (already done before this run):
Tests passing:
Build status:
Notes:

---

## RESUMPTION GUIDE

If Claude Code was interrupted, paste this prompt to resume:

"Read TASKS.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions in the file exactly.
Do not repeat tasks already marked [DONE]."
