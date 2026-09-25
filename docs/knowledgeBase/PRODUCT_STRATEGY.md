# AlumTribe — Product Strategy & Monetization Ideas

> Living document. Add ideas as they come. Review before each major build cycle.
> Last updated: September 2026

---

## The Core Problem We're Solving

Most alumni apps fail because they're nostalgia-only. Nostalgia gets people to sign up. It doesn't bring them back daily.

The apps people open every day have one thing in common: **they create new value every time you open them.** WhatsApp has new messages. Instagram has new content. LinkedIn has job anxiety. Strava has kudos from today's run.

AlumTribe's current design is a destination app — people come when they have a reason, do a thing, leave. The strategic shift is to add a layer that creates daily pull.

**The reframe:**
> "AlumTribe is how you leverage your most trusted network — your school batch — to advance your career."

Nostalgia gets people in. Career utility keeps them coming back.

---

## Retention Problem — Honest Assessment

- Only ~5% of alumni network app users return after signup (industry average)
- WhatsApp groups beat dedicated alumni platforms on retention because they live where people already are
- The nostalgia spike happens at signup then flatlines
- LinkedIn is the closest competitor but it's cold and transactional — asking a batchmate for a referral feels warmer than asking a LinkedIn connection you barely know

---

## Feature Ideas — Ranked by Retention Impact

### 1. "Who do I know at [Company]?" — Highest impact

A company directory inside AlumTribe. Every user lists where they work.
Alumni can search: "Who from my batch works at Google? Infosys? Razorpay?"

**Why it works:**
- Creates a genuine daily use case — every job hunt, career change, or warm intro starts here
- WhatsApp groups can't do this — you'd scroll years of chat history to find who works where
- The retention loop: user gets a job through an AlumTribe connection → tells others → more people update profiles → more people search → compound growth

**What to build:**
- "Where I work" field on profile (company, role, city)
- Search: "Find alumni at [company]" filtered by institution or batch
- "Warm intro" request — ask a mutual batchmate for an introduction
- Optional: "Open to referrals" flag on profile

---

### 2. Batch anniversaries and memory moments — Emotional hook

Nostalgia spikes are powerful but infrequent. Manufacture smaller versions at regular intervals.

**Features:**
- "On this day" — surface old messages or photos on their anniversary date
- Batch anniversary alerts — "Your Class 9A batch graduated 15 years ago this month"
- Milestone celebrations — "Priya just hit 10 years at her company" → batch congratulates her
- Reunion countdown — "Your batch reunion is in 3 months — 12 people are going"
- Annual "Year in review" for each classroom — new members, messages, milestones

**Why it works:**
- Creates natural reasons to open the app without user effort
- Taps into genuine emotion — people feel it, not just see it
- Push notification hook: "Your batch has a memory for you"

---

### 3. "Ask your batch" — Trusted crowdsourced advice

Your school batch is a trusted inner circle. A lightweight Q&A layer on top of the classroom.

**Examples:**
- "Looking for a good cardiologist in Mumbai" → batchmates answer
- "Anyone know the Canada visa process?" → someone in Canada answers
- "Best CA for startup compliance?" → the CA in the batch answers
- "Recommend a plumber in Kolkata?" → someone local answers

**Why it works:**
- More trusted than Reddit or Google because it comes from people you actually know
- WhatsApp groups do this but answers get buried — structured Q&A doesn't
- Gives people a reason to open the app even when they don't have anything to say
- Creates ongoing activity in classrooms that would otherwise go quiet

**What to build:**
- Question post type in the classroom feed (separate from regular messages)
- Tag categories: Career / Health / Local services / Travel / General
- "Best answer" mark by the question asker
- Notify batchmates in relevant city/profession when a question is asked

---

### 4. Warm job board — Referral-first hiring

Not a generic job board. Only jobs posted by alumni, for alumni from the same institution.

**Format:**
- "Rahul from Class 9A is hiring at his startup — 2 backend roles open"
- "Priya Ma'am is looking for a teaching assistant at her college"
- Referral explicit: "Apply through Rahul for a warm referral"

**Why it works:**
- A referral from a batchmate converts dramatically better than a cold application
- Gives people a financial reason to check the app regularly — real money at stake
- Both sides benefit: hirer gets trusted candidates, job seeker gets warm intro
- Network effect: more alumni = more jobs = more reasons to stay

**What to build:**
- Job post type in classroom or institution feed
- "I can refer" button — notifies the poster, connects them with the applicant
- Job alert settings — "notify me of jobs in [city] in [industry]"
- Expiry: jobs auto-expire after 30 days

---

### 5. Mentorship matching — Structured, not random

Most alumni mentorship is unstructured and fades quickly. Build a light structure around it.

**Format:**
- Junior alumni (0-5 years post-graduation) can request mentorship
- Senior alumni can mark themselves "open to mentor"
- Matching based on: same institution, same field/industry, same city
- 1 mentor - 1 mentee per quarter (prevents overload)
- Light structure: 2 check-ins per quarter, shared goals

**Why it works:**
- Creates a sustained reason to open the app (scheduled check-ins)
- Senior alumni feel good — it's low effort giving back
- Junior alumni get genuine career value
- Differentiated from LinkedIn mentorship which is cold and unstructured

---

## Monetization Ideas

### Current model (not built yet, just planned)
- Individual premium subscription
- School/institution subscriptions

### Better model — Career layer monetization

**Principle: Free forever for connection. Charge for career utility.**

---

**Tier 1 — Free (always)**
- Join classrooms, message batchmates
- View who's in your batch
- Basic profile

**Tier 2 — Career (₹299/month or ₹2,499/year)**
- "Who works at [company]" search across all your institutions
- Warm intro requests (limited on free)
- Job board access
- Mentorship matching
- Career profile (skills, open to referrals, open to work)
- See who viewed your profile

**Tier 3 — Institution subscription (₹X per institution per year)**
- School admin dashboard
- Batch code generation
- Analytics on alumni engagement
- Official event posting
- Alumni directory export (for development/fundraising)
- Verified institution badge

**Tier 4 — Referral success fee (future, experimental)**
- If a hire happens through an AlumTribe warm intro: small success fee
- Paid by the hiring company, not the individual
- Requires tracking which is complex — P2 at earliest
- Model used by: Hired.com, Underdog.io, some niche job boards

---

### Why not charge individuals for basic access?

Data point: Only 5% of alumni app signups ever return. If you charge at the door, you'll never build the network effect needed for the career layer to have value. Free basic access builds the network. The network makes the career features valuable. The career features generate revenue.

Classic two-sided marketplace: get supply (alumni profiles) free, charge for demand (job seekers, hirers, institutions).

---

## What NOT to Build

Based on research and comparable product failures:

- **Generic content feed** — alumni don't want to post about their lives to their school batch the way they do on Instagram. Different context.
- **Event ticketing** — too complex, too infrequent, use Eventbrite/Meetup for this.
- **Fundraising / donation** — people hate it, associated with boring university alumni offices.
- **Gamification for its own sake** — badges and points without real value feel hollow in a professional context.
- **Video calls** — use Zoom. Don't rebuild Zoom.
- **Stories / reels** — wrong context. People use Instagram for this.

---

## Validation Questions for First 10 Users

Before building any of the above, ask early users:

1. "What would make you open this app every week without being asked?"
2. "Have you ever needed a job referral from someone in your batch? How did you handle it?"
3. "What's the most useful thing a batchmate has ever done for your career?"
4. "If you could ask your entire batch one question right now, what would it be?"
5. "What do you wish WhatsApp groups were better at?"

The answers will confirm (or challenge) the career utility hypothesis.

---

## Competitive Landscape

| Platform | Strength | Weakness | AlumTribe opportunity |
|---|---|---|---|
| WhatsApp groups | Where people already are, zero friction | No structure, no search, no profiles, noise | Structure + verified identity |
| LinkedIn | Professional graph, job search | Cold, transactional, not batch-specific | Warm trusted batch context |
| Facebook groups | Familiar, free | Dying with younger users, noisy, no verification | Verification + privacy |
| Existing alumni platforms (Hivebrite, Almabase) | Feature-rich | Expensive, institution-facing not alumni-facing, <3% return | Alumni-first design |
| Nothing / memory | Free | No value | Any value at all is a win |

**AlumTribe's unique position:** Verified, batch-specific, warm-trust network. None of the above have all three.

---

## The Strava Parallel

Strava started as a fitness tracker. The fitness tracking got people in the door. The social layer — kudos, segments, clubs — made it a daily habit with 100M+ users and 35+ sessions per month per user.

AlumTribe's equivalent:
- Classroom connection = the fitness tracker (gets people in)
- Career utility layer = the social layer (makes it a daily habit)

The goal isn't to replace WhatsApp groups. The goal is to be the layer on top that WhatsApp can't be — structured, verified, career-useful, and searchable.

---

## Open Questions

- Should career features be a separate product or deeply integrated?
- What's the right monetization timing — charge from day 1 or wait for network effect?
- India-first or global from day 1?
- Schools only, or extend to corporate alumni (ex-Infosys, ex-TCS batches)?
- Should AlumTribe own the reunion planning, or just facilitate it?

---

*Add ideas below as they come up in conversations, user feedback, or research.*

---

## Technical Debt & Future Engineering

### Session Management — Current State and Gaps

**What is built (MVP):**
- Custom JWT implementation, signed with `JWT_SECRET`
- 7-day token expiry
- Sessions table in Supabase (record per session)
- Logout invalidates session record
- Password change invalidates existing sessions
- Max 5 concurrent devices enforced in code
- MFA mandatory for all users

**What is NOT built (known gaps):**
- No idle/inactivity timeout — session stays valid 7 days regardless of activity
- No sliding expiry — token does not refresh on activity
- No token rotation — the 7-day JWT is the only token (no refresh token pattern)
- No device fingerprinting
- No suspicious login detection (new location, new device, unusual hours)
- No "sign out all devices" feature visible to users
- Session table may not be validated on every request — if auth middleware only
  verifies JWT signature and not DB record, logout does not truly revoke access

**Priority order for fixing:**

Priority 1 - Before real user growth:
- Validate session exists in DB on every authenticated request
  so logout actually works server-side, not just client-side
- Add "Sign out all devices" button in profile settings

Priority 2 - Before 1000 users:
- Implement proper refresh token pattern:
  short-lived access token (15 min) + long-lived refresh token (30 days)
  stored in httpOnly cookie (web) and SecureStore (mobile)
- Idle timeout: 30 minutes inactivity triggers re-authentication
- Re-authentication prompt for sensitive actions (admin approvals,
  MFA reset, account deletion) without full logout

Priority 3 - Before 10k users:
- Consider migrating to Supabase Auth sessions entirely
  (handles refresh, rotation, device tracking out of the box)
  or evaluate Auth0 (free tier: 7500 MAUs)
- Anomaly detection: flag logins from new countries, new devices
- Login history visible to users (last 10 sessions, device, location, time)
- Session management page: see all active sessions, revoke individual ones

---

### IAM — Current Approach and Future Options

**Current:** Custom NestJS JWT auth — no dedicated IAM.

**Why this is fine for MVP:**
- Full control, no vendor lock-in, no per-MAU cost
- MFA + audit logging already implemented
- Works for thousands of users

**When to consider a dedicated IAM:**

Option A — Supabase Auth (easiest migration):
- Already using Supabase, would unify auth with DB
- Handles refresh tokens, device sessions, OAuth
- Cost: included in Supabase plan
- Migration effort: medium (replace custom JWT with Supabase JWT)

Option B — Auth0:
- Free tier: 7500 MAUs
- Paid: $23/month for 1000 MAUs (expensive at scale)
- Best for: enterprise SSO, complex org-level access
- Not ideal for consumer app at scale due to cost

Option C — Clerk:
- Developer-friendly, good UI components
- Free tier: 10k MAUs
- $25/month beyond that
- Good middle ground — worth evaluating at 5k users

**Recommendation:** Stay custom until 10k MAUs, then evaluate
Supabase Auth migration or Clerk depending on team size.

---

### Custom IAM — Conscious Decision Log

**Decision date:** September 2026
**Decision:** Build custom auth instead of using Okta, Ping, ForgeRock, Auth0 etc.
**Decision maker:** Ambar (founder)

**What we have built (custom IAM features):**
- User registration and login
- Password hashing and validation (bcrypt)
- JWT token issuance and validation
- MFA — TOTP (authenticator app) and Email OTP
- MFA recovery flow (email link + recovery codes)
- Session management (sessions table, max 5 concurrent)
- Password reset flow (time-limited tokens)
- Logout and server-side session revocation
- Role-based access control (student/teacher/admin per classroom)
- Device fingerprinting (forensic logging)
- Active sessions list with per-session revocation
- Sign out all devices
- Idle timeout (30 min frontend detection)
- Audit logging for all auth events

**What enterprise IAM gives that we don't have:**
- SSO / SAML 2.0 / OIDC federation (needed for school IT depts)
- Active Directory / LDAP sync
- Adaptive MFA (risk-based, not always triggered)
- Bot detection and fraud scoring at scale
- SOC2 / HIPAA compliance reporting out of the box
- SLA guarantees (99.99% uptime with dedicated security team)
- Passwordless / passkeys
- Suspicious login detection (planned but not built)
- Refresh token rotation (planned but not built)

**Why custom is fine at this stage:**
- Okta/Ping: $2-4 per MAU/month = $20-40k/month at 10k users
- Auth0: free to 7,500 MAUs, then $23/1000 MAUs
- Clerk: free to 10k MAUs, then $25/month — most affordable
- ForgeRock/Ping: enterprise only, $100k+/year contracts
- Building custom = zero cost, full control, no vendor dependency

**Risks of custom auth — acknowledged:**
- Security vulnerabilities if auth code has bugs
  Mitigation: penetration test before any public launch
- Maintenance burden — every new auth feature built from scratch
  Mitigation: don't over-engineer, build only what's needed
- Compliance risk if SOC2/ISO27001 ever required
  Mitigation: document all controls, evaluate migration at that point
- If school enterprise contracts require SAML SSO
  Mitigation: evaluate Auth0 or Clerk at that point

**Migration path if needed:**
```
0-10k users:    Keep custom (current)
10k users:      Evaluate Clerk (cheapest, developer-friendly)
Enterprise:     Evaluate Auth0 or Okta if SAML/SSO required
Migration cost: 2-4 weeks engineering to migrate auth layer
```

**Suspicious login detection — planned:**
On each login, compare current IP/device/location to
login history. Flag if: new country, impossible travel,
5+ failed attempts. Send email alert, don't auto-block.
Needs: login_history table, IP geolocation API (ipapi.co free tier).
Estimated effort: 2-3 days.

**Refresh token pattern — planned:**
Replace 7-day JWT with 15-min access token + 30-day refresh token.
Reduces stolen token exposure from 7 days to 15 minutes.
Needs: refresh_tokens table, POST /auth/refresh endpoint,
frontend interceptor for silent refresh.
Estimated effort: 3-5 days. Do after 1000 users.

---

### Other Technical Debt to Address Eventually

**Supabase Realtime JWT mismatch:**
Custom NestJS JWTs don't work with Supabase Realtime RLS.
Frontend falls back to 5-second polling for message updates.
Fix: use Supabase Auth tokens for Realtime, keep custom JWTs
for API calls. Or extract messaging to a dedicated WebSocket server.
Address when real-time messaging becomes a core engagement driver.

**No CI/CD pipeline:**
Currently deploying by pushing to main. No automated tests in CI.
Before team grows: add GitHub Actions workflow that runs
npm run test on every PR and blocks merge if tests fail.

**No staging environment:**
All testing happens in production. Add staging when:
- There are real users in production who could be broken
- Making risky changes (database migrations, auth changes)
- A second person joins the team

**Frontend has no integration tests:**
All 278 tests are backend unit tests. Frontend was never
integration tested — bugs only surface through manual testing.
Add Playwright or Cypress end-to-end tests for the critical paths:
signup → MFA → onboarding → create classroom → send message
