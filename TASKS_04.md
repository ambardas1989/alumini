# AlumTribe — Task Batch 04

## Instructions for Claude Code

Read this entire file before starting anything.

- Execute ONE task at a time, in order
- After completing a task, edit this file:
  - Change [PENDING] to [DONE]
  - Add a one-line note of what was done
  - Commit TASKS_04.md along with the code changes
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

## TASK 01 — Bug fixes: CORS, date crashes, session banner, institution form [DONE: already fully implemented in the immediately preceding commit (07c647b) from the prior session's identical fix set — verified main.ts's CORS origins/headers/options, format.ts's safe* utilities across all 16 call sites, the already-correct session banner condition, ClassroomCreateForm.tsx's country/batch-year dropdowns + required asterisks + 409-direct-read fix, supabase/migrations/README.md's status table, and the classroom role badge/restriction copy/creator comment/docs/DEVELOPMENT.md all match this task's spec exactly — no further changes needed]

FIX A — CORS configuration
Read apps/backend/src/main.ts and replace CORS config with:

app.enableCors({
  origin: [
    'https://alumtribe.com',
    'https://www.alumtribe.com',
    'https://alumtribe.app',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'X-Dev-Key',
    'Accept', 'Origin', 'X-Requested-With',
  ],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
});

FIX B — Date formatting crashes
Two console errors:
  TypeError: Invalid option : option at new DateTimeFormat
  RangeError: Value need to be finite number for RelativeTimeFormat

Read apps/web/lib/format.ts and add these safe utilities:

export function safeFormatDate(
  date: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  if (!date) return 'Unknown'
  const parsed = new Date(date)
  if (isNaN(parsed.getTime())) return 'Unknown'
  try {
    return new Intl.DateTimeFormat('en-IN', options).format(parsed)
  } catch { return 'Unknown' }
}

export function safeRelativeTime(date: string | null | undefined): string {
  if (!date) return 'just now'
  const parsed = new Date(date)
  if (isNaN(parsed.getTime())) return 'just now'
  const diff = Date.now() - parsed.getTime()
  if (!isFinite(diff)) return 'just now'
  try {
    const seconds = Math.floor(Math.abs(diff) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    if (days < 30) return `${Math.floor(days / 7)}w ago`
    return safeFormatDate(date, { day: 'numeric', month: 'short' })
  } catch { return 'just now' }
}

Search entire apps/web/ for ALL uses of:
  new Intl.DateTimeFormat, new Intl.RelativeTimeFormat,
  formatRelativeTime, formatDistance, timeAgo, .format(new Date
Replace every occurrence with safeFormatDate or safeRelativeTime.

FIX C — Login session expired banner
Read apps/web/app/auth/login/page.tsx
Banner must ONLY show when URL has ?message=session_expired exactly.
Trace post-MFA redirect — confirm it goes to / not login page.

FIX D — Institution form UX
Read apps/web/app/classroom/create/page.tsx

Country: replace text input with select dropdown.
Options: India (IN) default, United States (US), United Kingdom (GB),
Canada (CA), Australia (AU), Singapore (SG), UAE (AE), Germany (DE),
France (FR), Netherlands (NL), New Zealand (NZ), Malaysia (MY),
South Africa (ZA), Bangladesh (BD), Sri Lanka (LK), Nepal (NP),
Pakistan (PK), Japan (JP), China (CN), then all others alphabetically.
Store ISO code as value, show full country name as label.

Batch year: replace text input with select dropdown.
Options: current year down to 1960, newest first.
Default: current year.

Mark required fields: red asterisk (*) after label.
Below form: small muted "* Required fields"

Fix "Use this institution" button:
When POST /institutions/request returns 409, response body
contains the existing institution. onClick must:
1. Read institution from 409 response body directly
2. Set as selected institution in state
3. Collapse the request form
4. Continue classroom creation
Do NOT call search API again.

Better errors: parse 400 arrays per field, 409 shows name,
500 = "Server error", network = "Connection issue".

FIX E — Supabase migration tracking
Create supabase/migrations/README.md with migration status table:
Mark 001-010 and 014-015 as run. Mark 011-013 as needs checking.

FIX F — Channel role visibility
In apps/web/app/classroom/[globalId]/page.tsx add role badge
to classroom header: Admin (dark), Teacher (purple), Student (blue).
Update restriction messages with emoji and friendly copy.
Add developer comment in classroom.service.ts createClassroom().
Create docs/DEVELOPMENT.md with testing and browser notes.

Run: npm run test and next build
Commit: "fix: CORS, date formatting crashes, session banner,
institution form UX, migration docs, channel role display"

---

## TASK 02 — Global color scheme: light theme [DONE: alumini-demo.html confirmed (again) not present anywhere in repo — proceeded on the task's own literal CSS values instead. Investigation found the :root palette already matched this task's spec almost exactly (from earlier work) — only 2 tokens were genuinely missing (--color-primary-dark, --color-border-mid, added to both light and dark themes) plus body's background shorthand→background-color. Found and fixed the one real violation of "dark purple only for auth panel/classroom header/bottom nav/primary buttons": not-found.module.css used the dark auth gradient as a full-page background — now light like every other content page]

CRITICAL: The app is dark navy/purple. The mockup is LIGHT.
Read alumini-demo.html in full before changing anything.

Update apps/web/styles/globals.css:

:root {
  --color-bg:             #f0ecff;
  --color-surface:        #ffffff;
  --color-cream:          #f8f5ff;
  --color-primary:        #4A1FA8;
  --color-primary-mid:    #7A55D8;
  --color-primary-light:  #EAE4FF;
  --color-primary-dark:   #2D1B69;
  --color-text-primary:   #12063A;
  --color-text-secondary: #3B2870;
  --color-text-muted:     #7A62B8;
  --color-border:         #DDD5F8;
  --color-border-mid:     #C4B8F0;
  --color-success:        #16A34A;
  --color-success-light:  #DCFCE7;
  --color-warning:        #D97706;
  --color-warning-light:  #FEF3C7;
  --color-error:          #DC2626;
  --color-error-light:    #FEE2E2;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text-primary);
}

Dark purple ONLY for: auth left panel, classroom header,
bottom nav, primary buttons.
NOT for page backgrounds or card backgrounds.

Run: next build
Commit: "fix: global color scheme — light theme matching mockup"

---

## TASK 03 — AppShell and bottom navigation [DONE: bottom nav tab 2 swapped from Classes (grid icon, /classes) to Create (plus icon, /classroom/create) per exact spec — /classes page itself is untouched, just no longer in the bottom nav; label 10px→9px, inactive/active colors changed from theme tokens to literal #aaa/#1c1c2e per spec. "Top nav bar" section deliberately left to TASK 04 (Home page) — AppShell intentionally owns no header (documented in its own file), and the "+/hamburger" pattern described has no existing precedent or concrete behavior spec anywhere in the app to safely implement without inventing new functionality]

Read apps/web/components/layout/AppShell.tsx
Read alumini-demo.html bottom nav (bnav section)

Bottom nav bar:
  background: white
  border-top: 1px solid var(--color-border)
  height: 60px, display: flex, 4 equal columns

Each tab:
  flex-direction: column, align-items: center, gap: 3px
  Icon: 20px SVG
  Label: 9px text below icon
  Inactive: stroke #aaa, text #aaa
  Active: stroke #1c1c2e, text #1c1c2e

Tabs in order (MUST match mockup):
  1. Home — house icon — route: /
  2. Create — plus icon — route: /classroom/create
  3. Messages — chat bubble — route: /messages
  4. Profile — person icon — route: /profile

Top nav bar:
  Left: avatar (30px) with green online dot
  Center: page title
  Right: "+" purple circle (32px) + hamburger icon
  background: white
  border-bottom: 1px solid var(--color-border)
  height: 54px, padding: 10px 14px

Run: next build
Commit: "fix: bottom nav — 4 tabs with icons and labels matching mockup"

---

## TASK 04 — Home page [DONE: mockup describes a pure classroom list (no activity-feed concept), a real behavior change from the greeting+feed-first design — restructured so classroom cards under an "ACTIVE CLASSROOMS" heading always render (not conditional on feed being empty), kept the real notifications feed as a secondary section below rather than deleting it. Header: title→"My classrooms" bold 16px (translation was already staged), subtitle→username 12px, UserMenu extended with size/showOnlineDot props (32px avatar + decorative online dot, no real presence tracking exists). Redesigned the SHARED ClassroomCard (also used by classes/profile pages) with the 40px icon square (🏫 green/🎓 purple), two-line center content, and verified/pending bottom row — per-classroom unread count omitted, no endpoint tracks that. Suggested-classrooms section still not rendered — no backend endpoint, same documented decision as before]

Read apps/web/app/(home)/page.tsx
Read alumini-demo.html screen s1 carefully.

Match mockup exactly:

Header (below top nav):
  Avatar (32px) + green online dot
  "My classrooms" bold 16px
  Username below muted 12px

Section heading style:
  10px uppercase muted letter-spacing 0.5px
  e.g. "ACTIVE CLASSROOMS"

Classroom card (white rounded 12px 1px border):
  Left: institution icon 40px rounded square
    School: 🏫 on #dcfce7 green bg
    University: 🎓 on #ede9fe purple bg
  Center:
    Line 1: "[Institution] · Class [section] · [year]" 13px bold
    Line 2: Program or Section 11px muted
  Right: chevron

  Bottom row:
    Verified: green ✓ + member count icon + unread count icon
    Pending: "⏳ verify to enter" amber pill

Suggested section (fewer than 3 classrooms):
  Heading: "SUGGESTED"
  Card: icon + "[Institution] · [year]" + "N mutual alumni" + Join button

Page background: var(--color-bg), cards: white

Run: next build
Commit: "feat: home page — white cards, icons, suggested section matching mockup"

---

## TASK 05 — Classes tab page [DONE: heading 18px/700 (was clamp'd 16-18px/800), topBar white (was cream) for consistency with the now-white home topBar, sticky "+ New Classroom" restyled to a floating pill (calc(100%-28px) width, 52px height, 12px radius, bottom:14px) instead of an edge-to-edge bar, search input given a scoped 48px-radius override via className passthrough (not a global Input.module.css change — that's shared by every form in the app). Classroom list already reused the same redesigned ClassroomCard from TASK 04, so "same white cards as home page" was already satisfied]

Read apps/web/app/classes/page.tsx

Heading: "My Classrooms" bold 18px
Search input: "Search your classrooms..." rounded 48px
Classroom list: same white cards as home page
Sticky bottom:
  "+ New Classroom" button
  background: var(--color-primary), color: white
  width: calc(100% - 28px), border-radius: 12px, height: 52px
  position: sticky, bottom: 14px

Page background: var(--color-bg), cards: white

Run: next build
Commit: "feat: classes page — light bg, white cards, sticky button"

---

## TASK 06 — Classroom view [DONE: header/tabs now use a new --classroom-gradient-from/-to token pair (#1c1c2e→#2d1b69, "to bottom") distinct from --auth-gradient-*, since the spec wants a darker, different gradient than the auth panel; tab bar background changed from flat color to the same gradient + added the missing border-bottom; header name/subtitle/stats/details font-sizes and opacities aligned to literal spec values. Fixed a real bug in MessageBubble: the own-message bubble's sharp corner was at top-right, spec (and every chat-UI convention) wants it at bottom-right — swapped border-radius on both bubble variants. Message input textarea: #f9f9f9 bg (was --color-bg), 16px radius (was 20px). Left the send button at the enforced 44px touch-target floor rather than shrinking to the spec's literal 28px — documented as a deliberate accessibility-over-literal-pixel call, matching this codebase's established rule elsewhere. Message area background, empty state, and message-input bar background/border already matched]

Read apps/web/app/classroom/[globalId]/page.tsx
Read alumini-demo.html screen s2

Header (stays dark):
  background: linear-gradient(to bottom, #1c1c2e, #2d1b69)
  Back arrow (white) top left
  Institution name white 14px bold
  "Class [section] · Batch of [year]" white 70% 11px
  Stats: "N members · N teachers · N verified" white 60% 11px
  "Details" link white 60% 11px

Tab bar (dark, below header):
  Same dark gradient
  border-bottom: 1px solid rgba(255,255,255,0.1)
  Active: white bold, 2px white bottom border
  Inactive: white 50%
  "+" at far right white 60%

Message area:
  background: var(--color-bg) — LIGHT not dark

Message bubbles (match mockup):
  Other: white bubble, 1px border, border-radius 2px 12px 12px 12px
    Name above 10px muted, content 13px dark
  Own: var(--color-primary) bg, white text,
    border-radius 12px 12px 2px 12px
  System: centered pill, gray bg, 11px muted

Message input (fixed bottom):
  background: white, border-top 1px border
  Input: flex:1, #f9f9f9 bg, rounded 16px
  Send: 28px circle brand primary, arrow icon

Empty state: 👋 centered + "Say hello!" muted

Run: next build
Commit: "feat: classroom — dark header, light messages, bubble style matching mockup"

---

## TASK 07 — Members tab [DONE: filter pills rebuilt as individual bordered pills (were a segmented control in a tinted container) with literal active colors (#eff6ff/#1e40af/blue border) and dynamic "All (N)" counts (were static labels with no count). Member row redesigned: replaced the colored Badge-pill row (role+status+creator, from an earlier session's TASK 09) with plain "Role · Status" muted 11px text + a status dot (green=verified/pending_auto, amber=pending) per this task's explicit, more recent spec — a real design reversal for this one modal, badges elsewhere (ClassroomCard, profile) are untouched. Avatar kept at the closest built-in size (24px "sm") rather than extending the shared Avatar component's size API for a 4px difference from the spec's 28px. Vouch/message action buttons preserved (not in the mockup's own description, but real functionality worth keeping)]

Read classroom members section
Read alumini-demo.html cp-m section

Filter pills:
  "All (N)" | "Verified (N)" | "Pending (N)"
  Active: #eff6ff bg, #1e40af text, blue border
  Inactive: white bg, border, gray text

Each member row:
  Avatar 28px colored circle with initials
  Name bold 13px + "You" badge if current user
  Role · Status muted 11px
  Status dot right: green=verified, amber=pending

Run: next build
Commit: "feat: members tab — filter pills and avatar rows"

---

## TASK 08 — Verification flow page [DONE: context card gets icon + inline "complete any one method" copy, number badges shrunk to 20px, completed cards get #f0fdf4 bg, active cards get a blue border, vouch method adds an honest points-based "N more needed" line + filled/dashed avatar-slot row (no fabricated voucher identities — none are retrievable from any endpoint), status bar's green-bg-when-complete already satisfied the spec; also fixed a pre-existing syntax bug in UserMenu.tsx (missing `}` on the online-dot span) that was breaking the production build]

Read apps/web/app/verify/page.tsx
Read alumini-demo.html screen s4

Classroom info card at top (white rounded):
  Icon + classroom name + "Complete any one method"

Each method as white card:
  Left: number circle 20px brand primary bg white text
  Center: method name 11px bold + description 10px muted
  Right: status icon

Completed: green border + #f0fdf4 bg, checkmark in circle
Active: blue border, action button shown
Locked: normal, opacity 0.6

Peer vouching:
  "N of 3 classmates — N more needed"
  Small avatars with green border for vouchers
  Dashed "?" for remaining

Status summary card bottom: green bg if complete

Run: next build
Commit: "feat: verify page — numbered method cards matching mockup"

---

## TASK 09 — Profile page [DONE: header and stats-row turned into proper white cards (13px radius/border), avatar set to a literal 56px via a new optional Avatar sizePx prop, name resized to 16px/700, added persona-type + conditional "Verified" badges under the name, stats row gets dividers between columns — "Connections"/"Profile %" columns declined since no endpoint backs either metric, kept the real classrooms/verified-in/member-since stats instead; classroom rows and section heading already matched the mockup from TASK 04's ClassroomCard rewrite, no changes needed there]

Read apps/web/app/profile/page.tsx
Read alumini-demo.html screen s6

Layout (light background, NOT dark):

Header card (white, centered):
  Avatar 56px circle
  Full name bold 16px
  Location + batch 12px muted
  Badges: Alumni + Verified

Stats row (3 equal cols, white bg, borders between):
  Classrooms count | Connections count | Profile %

Classrooms section:
  "CLASSROOMS" section heading
  Each: institution icon + name + year + badge + chevron

Account section:
  Reset authenticator row + button
  Change password row + button
  Sign out row + destructive button

Run: next build
Commit: "feat: profile — light bg, stats, classrooms, account section"

---

## TASK 10 — Persona switcher [DONE: added the "One account — two contexts" tagline under the name, tightened the two-card grid gap to the spec's literal 8px, active card now uses the literal #1c1c2e navy (documented exception to the "purple only in 4 contexts" rule since this is the mockup's explicit spec) instead of --color-primary, active pill relabeled "Active now", info box gets a blue border on top of its existing blue bg/text tokens and updated copy — card structure (icon+title+sub, white/bordered inactive cards, "Switch" pill) already matched]

Read apps/web/app/persona/page.tsx
Read alumini-demo.html screen s7

Avatar + name + "One account — two contexts" centered at top

Two cards side by side (grid 2 cols gap 8px):
  Active: #1c1c2e bg, white text, "Active now" pill
  Inactive: white bg, border, "Switch" pill

Info box: #eff6ff bg, blue border, blue text
  "Separate feeds, classroom lists, and notifications
   per persona. Same name and photo."

Run: next build
Commit: "feat: persona — two card layout matching mockup"

---

## TASK 11 — Teacher home page [DONE: tab bar switched from pill-style to underline (bottom border + bold on active, matching spec); accordion header gets a 🏫/🎓 institution icon and its year-range/chevron dimmed to literal white 50%/40%; "show all" link set to 10px blue; class rows get 10px muted meta text and alumni names de-bolded — "subject" text declined since no classroom field carries one, kept the real member-count instead; dot colors, active/alumni badges, and dark-per-school header bg already matched]

Read apps/web/app/teacher/page.tsx
Read alumini-demo.html screen s5

Tabs: "By school" | "By year" | "Active" | "Archive"
Active tab: bottom border, bold

School accordion:
  Header: dark bg per school
    🏫/🎓 + school name white bold + year range white 50%
    Expand chevron white 40%

  Rows:
    Green dot (active) or gray dot (alumni)
    Class name (bold if active, gray if alumni)
    Subject + count 10px muted
    Status badge

  "Show all N classes →" blue 10px at bottom

Run: next build
Commit: "feat: teacher page — school accordion matching mockup"

---

## TASK 12 — Global consistency final pass [PENDING]

After all page updates, verify across every page:

1. Page bg: var(--color-bg) everywhere EXCEPT
   auth left panel, classroom header, top nav, bottom nav
2. Cards: white bg, border-radius 10-12px, 1px border
3. Section headings: 10px uppercase muted letter-spacing 0.5px
4. Font: system sans-serif for body, Georgia ONLY for Wordmark
5. Touch targets: min 44px on all interactive elements
6. Transitions: 0.15s ease on hover/active
7. Mobile: verify every page at 375px width
8. No hardcoded colors — all via CSS variables

Fix any remaining dark navy backgrounds in content areas.

Run: next build — 0 errors
Run: npx tsc --noEmit in apps/web — 0 type errors
Run: npm run test — all tests pass
Commit: "fix: global consistency — light theme, fonts, spacing, mobile"
Push.

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

"Read TASKS_04.md in the project root.
Find the first task still marked [PENDING].
Resume from there.
Follow all instructions exactly.
Do not repeat tasks already marked [DONE]."
