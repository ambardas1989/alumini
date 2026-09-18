# Alumini — Functional Specification Document

> Version: 1.0  
> Status: Pre-development  
> Last updated: September 2026  
> Branding: Configurable — see `config/brand.ts`. App name TBD pending domain registration.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Features Table](#2-features-table)
3. [User Personas](#3-user-personas)
4. [Authentication & MFA](#4-authentication--mfa)
5. [Onboarding Flows](#5-onboarding-flows)
6. [Persona System](#6-persona-system)
7. [Classroom System](#7-classroom-system)
8. [Verification System](#8-verification-system)
9. [Messaging & Channels](#9-messaging--channels)
10. [Events System](#10-events-system)
11. [School Admin System](#11-school-admin-system)
12. [Teacher Features](#12-teacher-features)
13. [Premium Features](#13-premium-features)
14. [Audit & Traceability](#14-audit--traceability)
15. [Architecture](#15-architecture)
16. [Data Models](#16-data-models)
17. [API Surface](#17-api-surface)
18. [Security Model](#18-security-model)
19. [Legal & Compliance](#19-legal--compliance)
20. [Setup & Installation Guide](#20-setup--installation-guide)
21. [GitHub Setup & Workflow](#21-github-setup--workflow)
22. [Environment Variables Reference](#22-environment-variables-reference)
23. [Branding & Theming Guide](#23-branding--theming-guide)
24. [Open Questions & Decisions Log](#24-open-questions--decisions-log)

---

## 1. Product Overview

### 1.1 What Is This

A private, verified alumni connect platform organised around specific classrooms — not just schools. Users connect at the level of "Class 9A, MP Birla School, Kolkata, Batch of 2012" — not just "MP Birla alumni."

Each classroom has three private spaces:
- **Classroom** — all members (students + teachers) chat together
- **Staff Room** — faculty only, completely hidden from students
- **Student Alley** — students only, teachers cannot post

### 1.2 Core Principles

- **Verification first** — unverified members get read-only access with redacted content. Verification is a one-time permanent event.
- **Privacy by design** — documents auto-delete after 30 days. Corridor separation enforced at database level (RLS), not just UI.
- **One account, multiple personas** — a person who was a student and is now a teacher uses one login. Context switches, identity stays.
- **Configurable branding** — all brand strings, colours, and fonts live in config files. Changing the app name or colour scheme requires editing one file.

### 1.3 Global Classroom ID Schema

Every classroom gets a globally unique, structured ID that prevents duplicates and powers deep links.

**Schools (K-12):**
```
IN-KOL-MPBIRLA-9A-2012
│   │   │        │  └── Batch year (year they passed out of that class)
│   │   │        └───── Class + Section (9A, 10B, 12C)
│   │   └────────────── Institution slug (from institutions table)
│   └────────────────── City code (ISO)
└────────────────────── Country code (ISO 3166-1 alpha-2)
```

**Universities / Colleges:**
```
US-UCDAVIS-MBA-2025
│   │        │   └── Graduation year
│   │        └────── Program slug (MBA, BTECH, MBBS)
│   └─────────────── Institution slug
└─────────────────── Country code
```

---

## 2. Features Table

| # | Feature | Persona | Priority | Status |
|---|---------|---------|----------|--------|
| F01 | Sign up / login with Google OAuth | All | P0 | Not started |
| F02 | Sign up / login with email + password | All | P0 | Not started |
| F03 | MFA (TOTP + SMS fallback) | All | P0 | Not started |
| F04 | Role selection at onboarding | All | P0 | Not started |
| F05 | Persona switcher (Alumni / Teacher / School Admin) | All | P0 | Not started |
| F06 | Add persona to existing account | All | P0 | Not started |
| F07 | Institution search and autocomplete | All | P0 | Not started |
| F08 | Create a classroom (global ID generation) | Student / Teacher / School Admin | P0 | Not started |
| F09 | Duplicate classroom detection | System | P0 | Not started |
| F10 | Join a classroom | Student / Teacher | P0 | Not started |
| F11 | Read-only mode for unverified members (server-side redaction) | System | P0 | Not started |
| F12 | Verification — institutional email (secondary address, one-time code) | Student / Teacher | P0 | Not started |
| F13 | Verification — peer vouching (3pts, teacher = 1.5pts) | Student / Teacher | P0 | Not started |
| F14 | Verification — document upload (auto-deleted 30 days) | Student / Teacher | P0 | Not started |
| F15 | Verification — LinkedIn graduation import | Student / Teacher | P1 | Not started |
| F16 | Verification — personal institution code (name-tied, single-use) | Student / Teacher | P1 | Not started |
| F17 | Verification — batch code (capped to class size) | Student | P1 | Not started |
| F18 | Teacher verification (5+ student vouches OR appointment letter) | Teacher | P0 | Not started |
| F19 | Classroom chat — Classroom channel (all members) | All | P0 | Not started |
| F20 | Classroom chat — Staff Room (faculty only, hidden from students) | Teacher | P0 | Not started |
| F21 | Classroom chat — Student Alley (students only) | Student | P0 | Not started |
| F22 | Real-time messaging (Supabase Realtime) | All | P0 | Not started |
| F23 | Event creation (title, date, location, description) | All verified | P1 | Not started |
| F24 | Event card auto-posted to Classroom chat | System | P1 | Not started |
| F25 | RSVP to events (Going / Not going / Maybe) | All verified | P1 | Not started |
| F26 | Event list in class info sheet | All verified | P1 | Not started |
| F27 | Class info sheet (members, events, quick actions) | All | P0 | Not started |
| F28 | Teacher filing cabinet (by school → by year) | Teacher | P0 | Not started |
| F29 | Cross-classroom student search (teacher) | Teacher | P1 | Not started |
| F30 | Recommendation letter trigger from search | Teacher | P2 | Not started |
| F31 | School admin dashboard | School Admin | P0 | Not started |
| F32 | Admin — classrooms collapsed by year with + add | School Admin | P0 | Not started |
| F33 | Admin — verification queue (approve / reject documents) | School Admin | P0 | Not started |
| F34 | Admin — generate personal institution codes | School Admin | P1 | Not started |
| F35 | Admin — generate batch codes (capped) | School Admin | P1 | Not started |
| F36 | Admin — bulk CSV import (students → classrooms + codes) | School Admin | P1 | Not started |
| F37 | Admin — manage co-admins (add / remove, max 5) | School Admin | P0 | Not started |
| F38 | Admin — analytics (active alumni, top classrooms) | School Admin | P2 | Not started |
| F39 | Institution claim flow (with Alumini team approval) | School Admin | P0 | Not started |
| F40 | Push notifications (Expo + FCM) | All | P1 | Not started |
| F41 | Premium — Where Are They Now | Student / Alumni | P2 | Not started |
| F42 | Premium — Career paths breakdown | Student / Alumni | P2 | Not started |
| F43 | Premium — Reunion planner (RSVPs, polls, albums) | All | P2 | Not started |
| F44 | Premium — Memory capsule (anniversary highlights) | All | P2 | Not started |
| F45 | Premium — Extra storage (2GB vs 200MB) | All | P2 | Not started |
| F46 | Mutual alumni suggestions ("12 mutual alumni") | System | P2 | Not started |
| F47 | Profile — academic (verified) + professional (self-reported) | All | P1 | Not started |
| F48 | Audit log — all logins, MFA events | System | P0 | Not started |
| F49 | Audit log — all persona switches | System | P0 | Not started |
| F50 | Audit log — all verifications and approvals | System | P0 | Not started |
| F51 | Audit log — all admin actions | System | P0 | Not started |
| F52 | Audit log — institution claim events | System | P0 | Not started |

**Priority key:** P0 = MVP launch blocker / P1 = launch + 30 days / P2 = post-launch roadmap

---

## 3. User Personas

### 3.1 Student / Alumni
- Primary user
- Finds their batch, joins classrooms, connects with batchmates
- Can also be a teacher — handled via persona system
- Verification required to post

### 3.2 Teacher / Faculty
- Has 100s–1000s of classrooms over a career
- Filing cabinet view: organised by school → year
- Needs teacher-specific verification (student vouches or appointment letter)
- Can be an alumni of their own institution simultaneously

### 3.3 School Admin
- Registrar, principal, or appointed staff member
- Institution-level view: all classrooms, verifications, codes
- Up to 5 admins per institution (configurable in `config/app.ts`)
- First admin per institution must be manually approved by Alumini ops team
- Primary admin cannot be removed without ownership transfer
- All admin actions are audited

### 3.4 Alumini Internal (Platform Admin)
- Internal ops team only
- Web-only dashboard (not in mobile app)
- Approves institution claims
- Handles fraud, content moderation, institution database management
- Access controlled via Supabase service role — never exposed to users

---

## 4. Authentication & MFA

### 4.1 Supported Auth Methods
- Google OAuth (primary — recommended)
- Email + password (secondary)
- No username/password without email verification

### 4.2 MFA — Mandatory for All Users

MFA is required for all accounts. Users are prompted to set up MFA after first login. They cannot access core features until MFA is configured.

**Methods supported (in order of preference):**
1. TOTP authenticator app (Google Authenticator, Authy) — preferred
2. SMS OTP — fallback only (rate-limited, not available in all regions)

**MFA for admins — stricter:**
- School admins must use TOTP (SMS not accepted)
- MFA re-challenge required for: adding/removing co-admins, approving verifications, generating codes, bulk imports

### 4.3 Session Management
- JWT tokens with 7-day expiry
- Refresh tokens stored in secure httpOnly cookies (web) / SecureStore (mobile)
- Supabase handles token refresh automatically
- Concurrent session limit: 5 devices per account
- Session invalidation on password change or account compromise

### 4.4 Audit Requirements
Every auth event is written to `audit_logs` table:
- Login success / failure (with IP, device, timestamp)
- MFA setup
- MFA success / failure
- Password change
- Token refresh
- Session invalidation
- Persona switch (from → to, timestamp, IP)

---

## 5. Onboarding Flows

### 5.1 New User — Student / Alumni

```
1. Sign up with Google or email
2. Set up MFA (mandatory, cannot skip)
3. "What brings you here?" → Find my classmates
4. Search for institution (UDISE / AISHE / IPEDS database)
5. Select class + section + batch year
6. Global ID generated, duplicate check run
7. If class exists → join request
8. If class doesn't exist → create it (user becomes classroom admin)
9. Choose verification method
10. Land on Alumni home
```

### 5.2 New User — Teacher

```
1. Sign up with Google or email
2. Set up MFA
3. "What brings you here?" → Connect with my students
4. Search for institution
5. Select class(es) you taught
6. Join as teacher (amber badge — pending verification)
7. Teacher verification flow (student vouches or appointment letter)
8. Land on Teacher home (filing cabinet)
```

### 5.3 New User — School Admin

```
1. Sign up with Google or email
2. Set up MFA (TOTP mandatory)
3. "What brings you here?" → Manage my institution
4. Search for institution
5. "Claim this institution as admin"
6. Verify ownership:
   a. Institutional email OTP (preferred), OR
   b. Upload appointment letter / school letterhead
7. Claim enters pending queue
8. Alumini ops team reviews (target: 24 hours)
9. On approval: School Admin persona created, user notified
10. Land on Admin dashboard
```

### 5.4 Adding a Persona to Existing Account

```
Profile → Switch persona → + Add a persona
→ Follow relevant new user flow (5.1 / 5.2 / 5.3) but skipping sign-up
→ New persona added to existing account
→ Audit log: persona_added event
```

---

## 6. Persona System

### 6.1 Rules

- One account can have: Alumni, Teacher, School Admin (any combination)
- Each persona has its own: home feed, classroom list, notifications
- Same name, avatar, and profile across all personas
- Switching persona is instant — no re-login required
- Last active persona is remembered across sessions
- Adding a persona triggers the relevant verification/approval flow
- Persona switch is logged in audit_logs

### 6.2 School Admin — Multiple Admins Per Institution

- Max 5 admins per institution (configurable: `config/app.ts → INSTITUTION_MAX_ADMINS`)
- First admin = Primary Admin (set during institution claim)
- Primary Admin can: add admins, remove admins, transfer primary role
- Co-admins can: approve verifications, manage codes, manage classrooms
- Co-admins cannot: add/remove other admins, delete institution
- Removing an admin requires MFA re-challenge from Primary Admin
- All add/remove events logged in audit_logs with actor, target, timestamp, reason

### 6.3 Persona Data Model

```typescript
// Each user can have multiple personas
// persona_type: 'alumni' | 'teacher' | 'school_admin'
// institution_id: null for alumni, school_id for teacher/admin
// status: 'active' | 'pending_approval' | 'suspended'
```

See Section 16 (Data Models) for full schema.

---

## 7. Classroom System

### 7.1 Creating a Classroom

Any verified user can propose a classroom. The system:
1. Searches for existing classroom with same global ID
2. If found → shows existing classroom, offers to join
3. If not found → creates classroom, creator becomes classroom admin (verified)

### 7.2 Classroom Admin Hierarchy

| Level | Who | Can do |
|---|---|---|
| Platform admin | Alumini ops | Everything |
| School admin | Institution's registered admin | All classrooms in their institution |
| Classroom admin | Creator, or promoted by school admin | Single classroom |
| Verified teacher | Teacher in that classroom | Approve documents (if delegated) |

### 7.3 Channel Rules

| Channel | Who can read | Who can post | Teacher visibility |
|---|---|---|---|
| Classroom | All verified members | All verified members | Teachers can post |
| Staff Room | Verified teachers only | Verified teachers only | Students see tab exists, not content |
| Student Alley | Verified students only | Verified students only | Teachers cannot see or post |

**These rules are enforced at database level via Row Level Security (RLS) — not just in the UI.**

### 7.4 Unverified Member Access

| State | Can see | Can post |
|---|---|---|
| Not joined | Classroom name, member count | No |
| Joined, unverified | Chat (names and content server-side redacted) | No |
| Verified | Full access | Yes |

Redaction happens server-side. The API returns `R*** A.` for names and blurred content markers — not the real data. Frontend blur is a visual enhancement only.

---

## 8. Verification System

### 8.1 Methods (any one satisfies verification)

| # | Method | Best for | Friction | Notes |
|---|---|---|---|---|
| 1 | Institutional email OTP | Current/recent students | Low | Add as secondary — login email unchanged. Verification record permanent even after email expires. |
| 2 | Peer vouching | Old batches | Medium | 3pts needed. Student = 1pt. Teacher = 1.5pts. 2 teachers = verified. |
| 3 | Document upload | Anyone with paperwork | High | Admin reviews. Auto-deleted after 30 days (configurable: `config/app.ts → DOCUMENT_EXPIRY_DAYS`). |
| 4 | LinkedIn import | Professionals | Low | Auto-matches institution + graduation year. |
| 5 | Personal institution code | Partner school active students | Low | Name-tied, single-use, expires 90 days. |
| 6 | Batch code | Partner school old batches | Low | Capped to class size. Burns when full batch redeems. |

### 8.2 Teacher Verification (additional rules)

- Must verify per classroom (not globally)
- 5+ student vouches from that class = verified teacher
- OR: upload appointment letter / school ID (admin reviews)
- Teacher verified status displayed in classroom with amber badge → green badge

### 8.3 Vouching Points System

```
Points needed to verify: 3
Student vouch:           1 pt
Teacher vouch:           1.5 pts
2 teachers:              3 pts → instantly verified
3 students:              3 pts → verified
1 teacher + 2 students:  3.5 pts → verified
```

Configurable in `config/app.ts`:
```
VOUCH_POINTS_REQUIRED: 3
VOUCH_POINTS_STUDENT: 1
VOUCH_POINTS_TEACHER: 1.5
```

### 8.4 Verification Audit Trail

Every verification event logged:
- method used
- who initiated
- who approved (for document method)
- timestamp
- IP address
- result (approved / rejected / expired)
- rejection reason (if rejected)

---

## 9. Messaging & Channels

### 9.1 Real-time Stack

- Supabase Realtime (WebSockets on PostgreSQL change streams)
- No additional infrastructure required at MVP
- Upgrade path: extract to dedicated WebSocket server at ~10k concurrent users

### 9.2 Message Types

| Type | Description |
|---|---|
| `text` | Regular message |
| `event_card` | Auto-posted when event created (not editable) |
| `system` | Class created, member joined, verification approved |
| `attachment` | File or image (P1 feature) |

### 9.3 Message Retention

- Messages are permanent (no auto-delete)
- Users can delete their own messages
- Classroom admins can delete any message (logged)
- Deleted messages show as "Message deleted" tombstone

### 9.4 Attachment Storage Tiers

| Tier | Storage | Attachment size limit |
|---|---|---|
| Free | 200MB per classroom | 5MB per file |
| Premium | 2GB per classroom | 25MB per file |

---

## 10. Events System

### 10.1 Event Creation

Any verified member can create an event:
- Title (required)
- Date + time (required)
- Location — text or "Online" (optional)
- Description (optional)

On creation:
1. Event saved to `events` table
2. System auto-posts an `event_card` message to Classroom channel
3. Members notified via push notification

### 10.2 RSVP

Members can RSVP: Going / Not going / Maybe

RSVP stored in `rsvps` table. Count shown on event card in chat. Full list visible in class info sheet.

### 10.3 Past Events

Events older than the event date move to "Past events" section in class info sheet. The event card in chat remains (it's a message).

---

## 11. School Admin System

### 11.1 Institution Claim Flow

```
User requests claim
→ Verification (institutional email or document)
→ Enters platform admin queue
→ Platform admin approves/rejects
→ User notified
→ On approval: institution.claimed_by = user_id
→ Audit log: institution_claimed event
```

**First claim = Primary Admin. Cannot be self-serve.**
**Subsequent admins = invited by Primary Admin. Can be self-serve after institution is claimed.**

### 11.2 Admin Actions (all require MFA re-challenge)

- Approve/reject verification documents
- Generate personal codes
- Generate batch codes
- Bulk import via CSV
- Add co-admin
- Remove co-admin
- Transfer primary admin role

### 11.3 Co-Admin Invitation Flow

```
Primary Admin → Admins tab → Invite
→ Enter email address
→ System sends invitation email with magic link
→ Invitee accepts → co-admin persona created
→ Audit log: admin_invited, admin_accepted events
→ Slot count updated
```

### 11.4 CSV Bulk Import Format

```csv
first_name,last_name,email,class,section,batch_year,roll_number
Arjun,Kapoor,arjun@example.com,9,A,2026,42
Priya,Sharma,priya@example.com,9,A,2026,43
```

On import:
1. Validate CSV structure
2. Create classroom if not exists
3. Generate personal code per student
4. Email codes to students (if email provided)
5. Audit log: bulk_import event with full CSV metadata (not content)

### 11.5 Code Generation Rules

**Personal codes:**
- Format: `{COUNTRY}-{YEAR}-{RANDOM_6}` e.g. `IN-2026-A7K2PQ`
- Tied to: institution_id, classroom_id, student name, email
- Single use — marked `redeemed: true` after first use
- Expires: 90 days (configurable: `config/app.ts → CODE_EXPIRY_DAYS`)

**Batch codes:**
- Same format but not name-tied
- `max_redemptions` = class size (set by admin)
- `redemption_count` increments on each use
- Burns when `redemption_count >= max_redemptions`

---

## 12. Teacher Features

### 12.1 Filing Cabinet View

Teacher home organises classrooms as:
```
Institution A (32 classes)
  └── 2026 (active)
       ├── Class 9 · Sec A
       └── Class 9 · Sec B
  └── 2025 (alumni)
  └── 2024 (alumni)
Institution B (18 classes)
  └── ...
```

Active classes (current year - 1 to current year) bubble to top. Past classes collapse to alumni.

### 12.2 Cross-Classroom Student Search

Search by name across all classrooms the teacher has been verified in. Results show:
- Name, class, batch year
- Verification status
- Current role (if opted into "Where Are They Now")
- Message button
- Recommend button (opens recommendation letter template)

### 12.3 Career Timeline (Profile)

On teacher profile: "2,100+ students · 32 years · 3 schools"
Calculated dynamically from memberships table.

---

## 13. Premium Features

All premium features are behind a paywall. Non-paying users see a locked preview with a clear unlock CTA.

| Feature | Description | Implementation note |
|---|---|---|
| Where Are They Now | City, job, company for batchmates who opt in | Opt-in only. Data from self-reported profiles. |
| Career paths | Field breakdown for batch (Tech, Medicine, Finance…) | Aggregated from self-reported data |
| Reunion planner | RSVPs, location polls, photo albums inside classroom | Extends events system |
| Memory capsule | Anniversary highlights — surfaces old photos/messages | Cron job on batch anniversary dates |
| Extra storage | 2GB vs 200MB free | Storage tier check on upload |

**Pricing is configurable:** `config/app.ts → PREMIUM_PRICE_INR`, `PREMIUM_PRICE_USD`

---

## 14. Audit & Traceability

### 14.1 Audit Log Table

All events write to `audit_logs` table. Never deleted. Append-only.

```
audit_logs
  id            uuid
  event_type    text        -- see 14.2
  actor_id      uuid        -- user who performed the action (null for system)
  target_id     uuid        -- user/entity affected
  target_type   text        -- 'user' | 'classroom' | 'institution' | 'membership' | 'verification' | 'code'
  metadata      jsonb       -- event-specific data (no PII in cleartext)
  ip_address    inet
  user_agent    text
  persona       text        -- which persona was active: 'alumni' | 'teacher' | 'school_admin'
  created_at    timestamptz
```

### 14.2 Audit Event Types

```
auth.login.success
auth.login.failure
auth.mfa.setup
auth.mfa.success
auth.mfa.failure
auth.mfa.challenge         -- re-challenge for sensitive admin actions
auth.password.changed
auth.session.invalidated
auth.logout

persona.switched           -- from, to
persona.added
persona.removed

verification.submitted     -- method, classroom_id
verification.approved      -- by whom
verification.rejected      -- by whom, reason
verification.expired       -- document auto-deleted

classroom.created
classroom.joined
classroom.left
classroom.admin.promoted
classroom.admin.demoted

institution.claimed        -- claim submitted
institution.claim.approved -- by platform admin
institution.claim.rejected -- by platform admin, reason
institution.admin.invited
institution.admin.accepted
institution.admin.removed  -- by whom, reason
institution.admin.transferred -- primary role transferred

code.generated             -- type (personal/batch), classroom_id
code.redeemed              -- code_id, user_id
code.expired

admin.verification.approved
admin.verification.rejected
admin.bulk_import          -- row count, classroom_ids (no personal data)

message.deleted            -- by whom (user or admin)
event.created
event.deleted
```

### 14.3 Retention

Audit logs: retained indefinitely (regulatory minimum 2 years in most jurisdictions).
Auth logs: retained 1 year minimum.

### 14.4 Admin Audit Visibility

- School admins can view audit logs for their own institution only
- Platform admins can view all audit logs
- Users can view their own audit log (auth events, verifications, persona switches)

---

## 15. Architecture

### 15.1 Governing Principle

**Modular monolith now → microservices when a specific boundary hurts.**

NestJS modules = future service boundaries. No module touches another module's database table directly. Cross-module communication via NestJS EventEmitter (now) → Kafka (at scale).

### 15.2 Phase 1 Stack (MVP — 0 to 10,000 users)

| Layer | Technology | Version | Why |
|---|---|---|---|
| Mobile | React Native + Expo | SDK 51+ | Single codebase iOS + Android |
| Web / Admin Portal | Next.js App Router | 14+ | SSR for SEO, React for app shell |
| API | Node.js + NestJS | 10+ / 20+ | TypeScript-first, modular, microservice-ready |
| Database | PostgreSQL via Supabase | 15+ | Relational, RLS for privacy |
| Auth | Supabase Auth | Latest | Google OAuth, email, MFA built-in |
| Real-time | Supabase Realtime | Latest | WebSockets on PostgreSQL change streams |
| File Storage | Supabase Storage | Latest | S3-compatible, lifecycle rules for auto-delete |
| Push | Expo + Firebase Cloud Messaging | Latest | iOS APNs + Android FCM from one SDK |
| API Deploy | Render | Latest | Zero DevOps, free tier, auto-deploy from GitHub |
| Web Deploy | Cloudflare Pages | Latest | Free, commercial use, Next.js compatible |
| DNS + CDN | Cloudflare | Latest | Free tier, global edge |
| Email | Resend | Latest | 3,000 emails/month free |
| CI/CD | GitHub Actions | Latest | Free for open source / small teams |

### 15.3 NestJS Module Boundaries

```
apps/backend/src/modules/
  auth/           → JWT, MFA, session management, audit logging for auth events
  identity/       → user profiles, personas, persona switching
  classroom/      → creation, global ID generation, duplicate detection
  membership/     → roles, verification states, channel permissions
  corridor/       → messaging, real-time, read/write rules per channel
  verification/   → all 6 verification methods, document lifecycle
  events/         → event creation, RSVPs, event cards in chat
  notification/   → push, email, in-app notifications
  institution/    → institution database, admin claims, co-admin management
  codes/          → personal codes, batch codes, generation, redemption
  search/         → cross-classroom student search (teacher)
  premium/        → feature flags, payment status, storage tier
  audit/          → audit log writes, reads (used by all other modules)
  admin/          → school admin portal, bulk operations
```

**Rule:** Each module owns its database tables. Cross-module communication via events only.

### 15.4 Folder Structure

```
alumini/
├── apps/
│   ├── backend/                 NestJS API
│   │   ├── src/
│   │   │   ├── modules/         One folder per module (see 15.3)
│   │   │   ├── common/          Guards, decorators, filters, interceptors
│   │   │   ├── config/          All config — brand, app, database
│   │   │   └── main.ts
│   │   ├── test/                Integration tests
│   │   └── package.json
│   ├── web/                     Next.js web + admin portal
│   │   ├── app/                 App Router pages
│   │   ├── components/          Shared UI components
│   │   ├── config/              Brand + app config (shared with backend via package)
│   │   └── package.json
│   └── mobile/                  React Native + Expo
│       ├── app/                 Expo Router screens
│       ├── components/          Shared mobile components
│       ├── config/              Brand + app config
│       └── package.json
├── packages/
│   ├── config/                  Shared brand + app config (used by all apps)
│   │   ├── brand.ts             App name, tagline, colours, fonts
│   │   └── app.ts               Feature flags, limits, expiry values
│   ├── types/                   Shared TypeScript types + DTOs
│   └── utils/                   Shared utilities (ID generation, validation)
├── supabase/
│   ├── migrations/              SQL migrations (numbered, sequential)
│   └── seed/                    Seed data for development
├── docs/
│   ├── SPEC.md                  This document
│   ├── SETUP.md                 Installation guide
│   ├── ARCHITECTURE.md          Detailed architecture decisions
│   └── LEGAL.md                 Legal and compliance notes
└── .github/
    └── workflows/               CI/CD pipelines
```

### 15.5 Phase 2 Additions (10k–500k users)

- Redis (Upstash) — caching, BullMQ job queue
- BullMQ — background jobs (verification workflows, notification batching, anniversary cron)
- Typesense — full-text search (upgrade from PostgreSQL tsvector)
- Cloudflare R2 — file storage migration (cheaper egress)

### 15.6 Phase 3 Additions (500k–millions)

- Kafka — event streaming backbone
- GraphQL Federation — unified API across extracted services
- AWS ECS Fargate — containerised services
- ClickHouse — real-time analytics

---

## 16. Data Models

### 16.1 Core Tables

```sql
-- Users (extends Supabase auth.users)
profiles (
  id                uuid PRIMARY KEY REFERENCES auth.users(id),
  email             text UNIQUE NOT NULL,
  full_name         text NOT NULL,
  avatar_url        text,
  phone             text,
  mfa_enabled       boolean DEFAULT false,
  mfa_method        text CHECK (mfa_method IN ('totp', 'sms')),
  active_persona    text CHECK (active_persona IN ('alumni', 'teacher', 'school_admin')),
  linkedin_url      text,
  linkedin_verified boolean DEFAULT false,
  linkedin_education jsonb,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
)

-- Personas (one per role per user)
personas (
  id               uuid PRIMARY KEY,
  user_id          uuid REFERENCES profiles(id),
  type             text CHECK (type IN ('alumni', 'teacher', 'school_admin')),
  institution_id   uuid REFERENCES institutions(id),  -- null for alumni
  status           text CHECK (status IN ('active', 'pending_approval', 'suspended')),
  is_primary_admin boolean DEFAULT false,  -- for school_admin type only
  created_at       timestamptz DEFAULT now(),
  UNIQUE(user_id, type, institution_id)
)

-- Institutions
institutions (
  id               uuid PRIMARY KEY,
  name             text NOT NULL,
  slug             text UNIQUE NOT NULL,
  type             text CHECK (type IN ('school', 'college', 'university')),
  city_code        text,
  country_code     text NOT NULL,
  email_domain     text,
  is_partner       boolean DEFAULT false,
  is_claimed       boolean DEFAULT false,
  claimed_by       uuid REFERENCES profiles(id),
  claimed_at       timestamptz,
  created_at       timestamptz DEFAULT now()
)

-- Classrooms
classrooms (
  id               uuid PRIMARY KEY,
  global_id        text UNIQUE NOT NULL,
  institution_id   uuid REFERENCES institutions(id),
  name             text NOT NULL,
  batch_year       integer NOT NULL,
  grade            text,   -- '9', '10', '12' etc for schools
  section          text,   -- 'A', 'B', 'C' etc
  program          text,   -- 'MBA', 'BTech' etc for colleges
  has_staff_room   boolean DEFAULT true,
  has_student_alley boolean DEFAULT true,
  require_verification boolean DEFAULT true,
  created_by       uuid REFERENCES profiles(id),
  member_count     integer DEFAULT 0,
  created_at       timestamptz DEFAULT now()
)

-- Memberships
memberships (
  id                   uuid PRIMARY KEY,
  user_id              uuid REFERENCES profiles(id),
  classroom_id         uuid REFERENCES classrooms(id),
  role                 text CHECK (role IN ('student', 'teacher', 'admin')),
  verification_status  text CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verification_method  text,
  verified_at          timestamptz,
  verified_by          uuid REFERENCES profiles(id),
  joined_at            timestamptz DEFAULT now(),
  UNIQUE(user_id, classroom_id)
)

-- Messages
messages (
  id               uuid PRIMARY KEY,
  classroom_id     uuid REFERENCES classrooms(id),
  channel          text CHECK (channel IN ('classroom', 'staff_room', 'student_alley')),
  sender_id        uuid REFERENCES profiles(id),
  content          text,
  message_type     text CHECK (message_type IN ('text', 'event_card', 'system', 'attachment')),
  metadata         jsonb,  -- event_id for event_card type
  is_deleted       boolean DEFAULT false,
  deleted_by       uuid REFERENCES profiles(id),
  deleted_at       timestamptz,
  created_at       timestamptz DEFAULT now()
)

-- Verifications
verifications (
  id                  uuid PRIMARY KEY,
  membership_id       uuid REFERENCES memberships(id),
  user_id             uuid REFERENCES profiles(id),
  classroom_id        uuid REFERENCES classrooms(id),
  method              text CHECK (method IN ('email', 'peer_vouch', 'document', 'linkedin', 'personal_code', 'batch_code')),
  status              text CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  document_url        text,
  document_expires_at timestamptz,
  vouches             jsonb DEFAULT '[]',
  vouch_points        numeric DEFAULT 0,
  code_id             uuid REFERENCES institution_codes(id),
  reviewed_by         uuid REFERENCES profiles(id),
  reviewed_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz DEFAULT now()
)

-- Institution codes
institution_codes (
  id               uuid PRIMARY KEY,
  institution_id   uuid REFERENCES institutions(id),
  classroom_id     uuid REFERENCES classrooms(id),
  code             text UNIQUE NOT NULL,
  type             text CHECK (type IN ('personal', 'batch')),
  -- Personal code fields
  bound_name       text,   -- name the code is tied to
  bound_email      text,
  -- Batch code fields
  max_redemptions  integer,
  redemption_count integer DEFAULT 0,
  -- Common
  is_redeemed      boolean DEFAULT false,  -- for personal codes
  redeemed_by      uuid REFERENCES profiles(id),
  redeemed_at      timestamptz,
  expires_at       timestamptz NOT NULL,
  generated_by     uuid REFERENCES profiles(id),
  created_at       timestamptz DEFAULT now()
)

-- Events
events (
  id               uuid PRIMARY KEY,
  classroom_id     uuid REFERENCES classrooms(id),
  created_by       uuid REFERENCES profiles(id),
  title            text NOT NULL,
  event_date       timestamptz NOT NULL,
  location         text,
  description      text,
  is_online        boolean DEFAULT false,
  created_at       timestamptz DEFAULT now()
)

-- RSVPs
rsvps (
  id               uuid PRIMARY KEY,
  event_id         uuid REFERENCES events(id),
  user_id          uuid REFERENCES profiles(id),
  status           text CHECK (status IN ('going', 'not_going', 'maybe')),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE(event_id, user_id)
)

-- Audit logs (append-only, never deleted)
audit_logs (
  id               uuid PRIMARY KEY,
  event_type       text NOT NULL,
  actor_id         uuid REFERENCES profiles(id),
  target_id        uuid,
  target_type      text,
  metadata         jsonb,
  ip_address       inet,
  user_agent       text,
  persona          text,
  created_at       timestamptz DEFAULT now()
)
```

---

## 17. API Surface

### 17.1 Base URL

```
Production:  https://api.{BRAND_DOMAIN}/v1
Development: http://localhost:3001/v1
```

### 17.2 Auth Endpoints

```
POST   /auth/signup              Create account
POST   /auth/login               Login with email/password
POST   /auth/google              Google OAuth callback
GET    /auth/mfa/setup           Get TOTP QR code
POST   /auth/mfa/verify          Verify TOTP code (setup)
POST   /auth/mfa/challenge       MFA challenge (sensitive actions)
POST   /auth/logout              Invalidate session
POST   /auth/refresh             Refresh JWT
```

### 17.3 Classroom Endpoints

```
GET    /classrooms               List user's classrooms
POST   /classrooms               Create classroom
GET    /classrooms/:globalId     Get by global ID
GET    /classrooms/:id/members   Member list (with redaction for unverified)
GET    /classrooms/:id/events    Event list
POST   /classrooms/:id/join      Join classroom
DELETE /classrooms/:id/leave     Leave classroom
```

### 17.4 Message Endpoints

```
GET    /classrooms/:id/messages/:channel    Paginated messages (with redaction)
POST   /classrooms/:id/messages/:channel    Send message
DELETE /messages/:id                        Delete message
```

### 17.5 Verification Endpoints

```
POST   /verify/email             Submit institutional email
POST   /verify/email/confirm     Confirm OTP
POST   /verify/vouch             Vouch for a member
POST   /verify/document          Upload document
POST   /verify/linkedin          LinkedIn import
POST   /verify/code              Redeem institution code
GET    /verify/status/:membershipId  Get verification status
```

### 17.6 Admin Endpoints

```
GET    /admin/institution/:id              Dashboard overview
GET    /admin/institution/:id/classrooms   Classrooms by year
GET    /admin/institution/:id/verifications  Pending queue
POST   /admin/verifications/:id/approve   Approve document
POST   /admin/verifications/:id/reject    Reject document
POST   /admin/codes/personal              Generate personal code
POST   /admin/codes/batch                 Generate batch code
POST   /admin/import                      CSV bulk import
GET    /admin/admins                      List co-admins
POST   /admin/admins/invite               Invite co-admin
DELETE /admin/admins/:userId              Remove co-admin
POST   /admin/admins/transfer             Transfer primary role
```

---

## 18. Security Model

### 18.1 Row Level Security (RLS)

Every table has RLS enabled. The corridor privacy rule is the most critical:

```sql
-- Staff Room messages: only verified teachers can read
CREATE POLICY "staff_room_read" ON messages
  FOR SELECT USING (
    channel != 'staff_room'
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = auth.uid()
      AND m.classroom_id = messages.classroom_id
      AND m.role IN ('teacher', 'admin')
      AND m.verification_status = 'verified'
    )
  );

-- Student Alley messages: only verified students can read
CREATE POLICY "student_alley_read" ON messages
  FOR SELECT USING (
    channel != 'student_alley'
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = auth.uid()
      AND m.classroom_id = messages.classroom_id
      AND m.role = 'student'
      AND m.verification_status = 'verified'
    )
  );

-- Unverified members: redacted content served by API, 
-- but RLS still prevents direct database access to real content
```

### 18.2 Server-Side Redaction

The API layer redacts content for unverified members before sending:
- Names: `Priya S.` → `P*** S.`
- Message content: returned as `[redacted]` marker
- Profile data: only initials returned

**Never rely on frontend-only blurring. Data must not leave the server unredacted.**

### 18.3 Document Security

- Verification documents uploaded to Supabase Storage private bucket
- Signed URLs generated per admin request (1-hour expiry)
- Auto-delete lifecycle rule: 30 days after upload
- No document content stored in database — only storage path
- Path deleted from database when document deleted

### 18.4 Rate Limiting

| Endpoint | Limit |
|---|---|
| POST /auth/login | 5/min per IP |
| POST /auth/mfa/* | 3/min per user |
| POST /verify/email | 3/hour per user |
| POST /verify/document | 3/day per user |
| POST /admin/codes/* | 10/min per admin |
| POST /admin/import | 1/hour per admin |

---

## 19. Legal & Compliance

> **Disclaimer:** This section provides an overview for awareness only. It does not constitute legal advice. Consult a qualified lawyer before launch, especially for data protection compliance.

### 19.1 India — Primary Market

**IT Act 2000 + IT (Amendment) Act 2008**
- Personal data handling rules apply
- Must have a Privacy Policy accessible before sign-up
- Data breach notification requirements

**DPDP Act 2023 (Digital Personal Data Protection Act)**
- Came into force August 2023. Rules being finalised.
- Key obligations:
  - Explicit consent before collecting personal data
  - Clear purpose limitation (only collect what you need)
  - Data principal rights: access, correction, erasure, grievance
  - Appoint a Data Protection Officer (DPO) if processing data at scale
  - Children's data (under 18): verifiable parental consent required
  - Cross-border data transfer: only to countries notified by central government

**Action items:**
- [ ] Draft Privacy Policy (plain language, required before launch)
- [ ] Draft Terms of Service
- [ ] Implement consent flows at sign-up
- [ ] Implement data deletion ("right to erasure") in user settings
- [ ] Add parental consent flow for users who identify as under 18
- [ ] Appoint DPO contact (can be founder initially)
- [ ] Add grievance officer contact in app

### 19.2 GDPR (EU/UK users)

If any users are in EU/UK, GDPR applies regardless of where you're incorporated.

Key obligations:
- Lawful basis for processing (consent or legitimate interest)
- Right to access, rectification, erasure, portability
- Data breach notification within 72 hours to supervisory authority
- Privacy by design (your architecture already does this — document auto-delete, RLS)
- Cookie consent if using analytics cookies on web

### 19.3 COPPA / Children's Data (US users)

If serving US users under 13: COPPA compliance required. Recommendation: add age gate at sign-up. If user indicates under 13 — block sign-up. Under 18 — trigger parental consent flow.

### 19.4 Education Records (FERPA — US)

If partner schools share student records (for bulk import) — FERPA may apply. Schools must have FERPA-compliant data sharing agreements before sharing student lists.

### 19.5 Document Retention and Deletion

- Verification documents: 30-day auto-delete (already designed)
- Audit logs: minimum 2 years (cannot be deleted)
- User data on account deletion: anonymise, don't delete (for audit integrity)
  - Profile PII removed, audit log entries retain anonymised actor reference

### 19.6 Defamation / Content Moderation

Private group chats carry legal risk if defamatory content is not removed when reported. Required:
- In-app report button on messages
- Response SLA: 48 hours for reports
- Content removal capability for platform admins
- Document moderation decisions (logged)

### 19.7 MFA and Authentication Security

Mandatory MFA is a strong security practice that also reduces liability in case of account compromise. Document this in your security whitepaper.

---

## 20. Setup & Installation Guide

> See `docs/SETUP.md` for the full step-by-step guide with screenshots.

### 20.1 Prerequisites

| Tool | Version | Link |
|---|---|---|
| Node.js | 20+ (LTS) | https://nodejs.org |
| npm | 10+ | Included with Node.js |
| Git | Any | https://git-scm.com |
| Expo CLI | Latest | `npm install -g expo-cli` |
| Supabase CLI | Latest | https://supabase.com/docs/guides/cli |

### 20.2 Accounts Required

| Service | Free tier | Link |
|---|---|---|
| Supabase | Yes — 500MB DB, 1GB storage | https://supabase.com |
| Render | Yes — free web service | https://render.com |
| Cloudflare | Yes — Pages + DNS | https://cloudflare.com |
| Firebase | Yes — FCM for push | https://firebase.google.com |
| Resend | Yes — 3,000 emails/month | https://resend.com |
| Apple Developer | $99/year | https://developer.apple.com |
| Google Play | $25 one-time | https://play.google.com/console |

### 20.3 Quick Start

```bash
# 1. Clone repository
git clone https://github.com/{your-org}/alumini.git
cd alumini

# 2. Install all dependencies
npm install

# 3. Copy environment files
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.local.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env

# 4. Fill in environment variables (see Section 22)

# 5. Run Supabase migrations
supabase db push

# 6. Start all services
npm run dev
```

---

## 21. GitHub Setup & Workflow

### 21.1 Repository Structure

```
Main branch:    main        (always deployable, protected)
Development:    dev         (integration branch)
Features:       feature/*   (e.g. feature/verification-email)
Fixes:          fix/*       (e.g. fix/message-redaction)
Releases:       release/*   (e.g. release/v1.0.0)
```

### 21.2 Branch Protection Rules (set in GitHub → Settings → Branches)

For `main` branch:
- [ ] Require pull request before merging
- [ ] Require at least 1 approval
- [ ] Require status checks (CI must pass)
- [ ] Require branches to be up to date
- [ ] Do not allow force pushes

### 21.3 CI/CD Pipeline

```yaml
# .github/workflows/ci.yml runs on every PR:
- Lint (ESLint)
- Type check (TypeScript)
- Unit tests (Jest)
- Build check
- Supabase migration validation

# .github/workflows/deploy.yml runs on merge to main:
- Deploy API to Render (auto via Render GitHub integration)
- Deploy web to Cloudflare Pages (auto via Cloudflare GitHub integration)
- Notify team on Slack/Discord
```

### 21.4 Commit Convention

```
feat: add peer vouching verification method
fix: redact message content for unverified members
chore: update dependencies
docs: add verification system documentation
test: add unit tests for classroom ID generator
refactor: extract audit logging to shared service
```

---

## 22. Environment Variables Reference

All variables with descriptions. See `packages/config/` for typed access.

### 22.1 Backend (`apps/backend/.env`)

```bash
# ── App ────────────────────────────────────────────────────
NODE_ENV=development             # 'development' | 'production' | 'test'
PORT=3001                        # API server port
APP_URL=http://localhost:3001    # Used for OAuth callbacks

# ── Supabase ───────────────────────────────────────────────
SUPABASE_URL=                    # From Supabase dashboard → Settings → API
SUPABASE_ANON_KEY=               # Public key — safe to expose in client
SUPABASE_SERVICE_ROLE_KEY=       # Secret key — NEVER expose in client

# ── JWT ────────────────────────────────────────────────────
JWT_SECRET=                      # Min 32 chars, random string
JWT_EXPIRY=7d                    # Token expiry

# ── Google OAuth ───────────────────────────────────────────
GOOGLE_CLIENT_ID=                # From Google Cloud Console
GOOGLE_CLIENT_SECRET=            # From Google Cloud Console
GOOGLE_CALLBACK_URL=http://localhost:3001/v1/auth/google/callback

# ── LinkedIn OAuth (for verification import) ───────────────
LINKEDIN_CLIENT_ID=              # From LinkedIn Developer Portal
LINKEDIN_CLIENT_SECRET=
LINKEDIN_CALLBACK_URL=http://localhost:3001/v1/auth/linkedin/callback

# ── Firebase (Push notifications) ─────────────────────────
FIREBASE_PROJECT_ID=             # From Firebase Console
FIREBASE_PRIVATE_KEY=            # Service account private key
FIREBASE_CLIENT_EMAIL=           # Service account email

# ── Email (Resend) ─────────────────────────────────────────
RESEND_API_KEY=                  # From Resend dashboard
FROM_EMAIL=hello@yourdomain.com  # Must be verified in Resend

# ── MFA ────────────────────────────────────────────────────
MFA_ISSUER=Alumini               # Shown in authenticator app
TWILIO_ACCOUNT_SID=              # For SMS OTP fallback (optional)
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

### 22.2 Web (`apps/web/.env.local`)

```bash
NEXT_PUBLIC_SUPABASE_URL=        # Same as backend SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # Same as backend SUPABASE_ANON_KEY
NEXT_PUBLIC_API_URL=http://localhost:3001/v1
NEXT_PUBLIC_APP_NAME=Alumini     # Overridden by brand config in production
```

### 22.3 Mobile (`apps/mobile/.env`)

```bash
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_API_URL=http://localhost:3001/v1
EXPO_PUBLIC_APP_NAME=Alumini
```

---

## 23. Branding & Theming Guide

All brand values live in `packages/config/brand.ts`. Change them once — all apps pick up the change.

### 23.1 `packages/config/brand.ts`

```typescript
export const brand = {
  // App identity — change these when domain is confirmed
  name: 'Alumini',              // App name shown in UI
  tagline: 'Your class. Your people. Connected forever.',
  domain: 'alumini.app',        // Used for deep links, emails

  // Colours — full theme
  colors: {
    // Primary accent — currently Midnight Purple
    primary:     '#4A1FA8',
    primaryLight: '#EAE4FF',
    primaryMid:  '#7A55D8',

    // Semantic colours
    success:     '#16A34A',
    successLight: '#DCFCE7',
    warning:     '#D97706',
    warningLight: '#FEF3C7',
    info:        '#2563EB',
    infoLight:   '#DBEAFE',

    // Dark mode overrides
    dark: {
      primary:     '#9D7FF5',
      primaryLight: '#3D3280',
      background:  '#1E1646',
      card:        '#2E2468',
      warning:     '#C49A3C',   // Muted gold — not bright amber on dark bg
      warningLight: '#2A2010',
    },
  },

  // Typography
  fonts: {
    primary: 'Outfit',          // Google Font — loaded in app entry point
    weights: {
      regular: '400',
      medium:  '500',
      semibold: '600',
      bold:    '700',
      extrabold: '800',
    },
  },

  // Channel names — configurable if you want to rename
  channels: {
    main:    'Classroom',       // The main all-members channel
    staff:   'Staff Room',      // Faculty-only channel
    student: 'Student Alley',   // Students-only channel
  },
} as const;

export type Brand = typeof brand;
```

### 23.2 `packages/config/app.ts`

```typescript
export const appConfig = {
  // Verification
  VOUCH_POINTS_REQUIRED:   3,
  VOUCH_POINTS_STUDENT:    1,
  VOUCH_POINTS_TEACHER:    1.5,
  DOCUMENT_EXPIRY_DAYS:    30,
  CODE_EXPIRY_DAYS:        90,

  // Institution admin
  INSTITUTION_MAX_ADMINS:  5,

  // Sessions
  SESSION_MAX_DEVICES:     5,
  JWT_EXPIRY_DAYS:         7,

  // Rate limits (requests per window)
  RATE_LIMIT_LOGIN:        5,    // per minute per IP
  RATE_LIMIT_MFA:          3,    // per minute per user
  RATE_LIMIT_VERIFY_EMAIL: 3,    // per hour per user
  RATE_LIMIT_VERIFY_DOC:   3,    // per day per user

  // Storage
  STORAGE_FREE_MB:         200,
  STORAGE_PREMIUM_MB:      2048,
  ATTACHMENT_FREE_MAX_MB:  5,
  ATTACHMENT_PREMIUM_MAX_MB: 25,

  // Premium pricing
  PREMIUM_PRICE_INR:       99,   // per month
  PREMIUM_PRICE_USD:       2,    // per month

  // Pagination
  MESSAGES_PAGE_SIZE:      50,
  MEMBERS_PAGE_SIZE:       25,
} as const;
```

---

## 24. Open Questions & Decisions Log

| # | Question | Decision | Date | Decided by |
|---|---------|---------|------|-----------|
| Q1 | App name | TBD — pending domain registration. Candidates: Passora, Batchly | Open | — |
| Q2 | Who can create a classroom | Any verified user. School admin = gold badge. Teacher = amber. Student = proposes, needs 5 verified members OR teacher co-sign | Decided | Session |
| Q3 | Verification threshold | 3 points. Student = 1pt. Teacher = 1.5pt | Decided | Session |
| Q4 | Teacher verification method | 5+ student vouches OR appointment letter upload | Decided | Session |
| Q5 | Channel naming | Classroom / Staff Room / Student Alley | Decided | Session |
| Q6 | Institution code security | Personal codes = name-tied, single-use. Batch codes = capped to class size | Decided | Session |
| Q7 | Admin login | Same login as all users. Role set at onboarding. | Decided | Session |
| Q8 | Multiple admins per institution | Yes. Max 5. Primary admin cannot be removed without transfer | Decided | Session |
| Q9 | Persona system | One account, multiple personas (Alumni / Teacher / School Admin). Dynamic — add persona without new account | Decided | Session |
| Q10 | App admin (Alumini ops) | Web-only internal dashboard. Not in mobile app. Not MVP. | Decided | Session |
| Q11 | Deployment | Render (API) + Cloudflare Pages (web) + Supabase (DB/auth) | Decided | Session |
| Q12 | MFA | Mandatory for all. TOTP preferred. School admins: TOTP only | Decided | Session |
| Q13 | SMS OTP for MFA | Fallback only for non-admins. Twilio integration | Decided | Session |
| Q14 | Read-only redaction | Server-side only. Frontend blur is enhancement not security | Decided | Session |
| Q15 | Premium pricing | ₹99/month India, $2/month international | Decided | Session |
| Q16 | Domain registrar | Cloudflare (wholesale pricing, same dashboard) | Decided | Session |
| Q17 | Tab naming | Classroom / Staff Room / Student Alley | Decided | Session |
