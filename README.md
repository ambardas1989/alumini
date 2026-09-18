# Alumini

Private verified alumni network organised around classrooms, not just schools.

> Brand name TBD pending domain registration. All brand values in `packages/config/brand.ts`.

---

## What is this?

- Each classroom = one specific batch at one institution (e.g. "Class 9A, MP Birla, Kolkata, 2012")
- Three private channels per classroom: Classroom (all), Staff Room (teachers only), Student Alley (students only)
- Verification required to post — 6 methods available
- One account, multiple personas (Alumni / Teacher / School Admin)

Full specification: `SPEC.md`

---

## Repository Structure

```
alumini/
├── apps/
│   ├── backend/         NestJS API
│   ├── web/             Next.js web app
│   └── mobile/          React Native + Expo
├── packages/
│   ├── config/          Brand + app config (shared)
│   ├── types/           TypeScript types (shared)
│   └── utils/           Pure utility functions (shared)
├── supabase/
│   └── migrations/      SQL migrations
├── docs/
│   └── SPEC.md          Full functional specification
└── .github/
    └── workflows/       CI/CD pipelines
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- npm 10+
- Supabase account and project created
- `.env` file configured (copy from `apps/backend/.env.example`)

### First time setup

```bash
# 1. Install all workspace dependencies
npm install

# 2. Copy and fill in environment variables
cp apps/backend/.env.example apps/backend/.env
# Edit apps/backend/.env with your Supabase URL, keys, etc.

# 3. Run database migrations
npx supabase db push
# Or paste supabase/migrations/001_initial_schema.sql into Supabase SQL Editor

# 4. Start development servers
npm run dev
```

### Running just the backend

```bash
npm run dev:backend
# API available at http://localhost:3001/v1
# Swagger docs at http://localhost:3001/docs (dev only)
```

### Running tests

```bash
npm run test              # Run all tests
npm run test:coverage     # With coverage report
```

---

## Importing into Claude Code

When you open this project in Claude Code, give it one module at a time:

```
"Read SPEC.md and apps/backend/src/modules/auth/. Build the auth module per the spec."
"Read SPEC.md Section 11 and build the institution admin module."
"Add the corridor (messaging) module with real-time support."
```

Claude Code will read the spec, understand the conventions, and build each module
consistently. Always run tests before moving to the next module.

### Module build order (recommended)

1. `auth` — JWT, MFA, Google OAuth, sessions
2. `identity` — profiles, persona switching
3. `institution` — institution claim, admin management
4. `classroom` — creation, duplicate detection (scaffold already done)
5. `membership` — roles, join/leave
6. `verification` — all 6 methods (scaffold already done)
7. `corridor` — messaging, real-time
8. `events` — events + RSVPs
9. `codes` — code generation, redemption
10. `notification` — push + email
11. `search` — cross-classroom teacher search
12. `admin` — school admin portal
13. `premium` — feature flags + payment

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Mobile | React Native + Expo | iOS + Android |
| Web | Next.js | App Router |
| API | NestJS | TypeScript, modular |
| Database | Supabase (PostgreSQL) | With RLS |
| Auth | Supabase Auth | Google OAuth + email |
| Real-time | Supabase Realtime | Chat, notifications |
| Storage | Supabase Storage | Documents + media |
| Push | Firebase Cloud Messaging | iOS APNs + Android |
| Email | Resend | Transactional |
| Deploy — API | Render | Free tier |
| Deploy — Web | Cloudflare Pages | Free tier |
| DNS | Cloudflare | Free tier |

**Cost at launch: ~₹850/year (domain only). Everything else free tier.**

---

## Key Design Decisions

- **Privacy by design**: Document auto-delete (30 days), server-side name redaction, RLS enforced at DB level
- **Audit everything**: All logins, persona switches, admin actions, verifications logged to `audit_logs` (append-only)
- **Modular monolith**: NestJS modules = future microservice boundaries. No cross-module DB access.
- **One config file for branding**: Change `packages/config/brand.ts` to rebrand
- **One config file for feature flags**: Change `packages/config/app.ts` for limits, prices, thresholds

---

## Legal

See `SPEC.md` Section 19 for legal and compliance notes (DPDP 2023, GDPR, COPPA, FERPA).

**Required before launch:**
- [ ] Privacy Policy (plain language)
- [ ] Terms of Service
- [ ] Consent flows at sign-up
- [ ] Data deletion ("right to erasure") in settings
- [ ] DPO contact in app

---

## Branding

All brand values in `packages/config/brand.ts`. Change once — all apps pick it up.

To rebrand:
1. Edit `packages/config/brand.ts` — name, tagline, domain, colors, fonts
2. That is all.
