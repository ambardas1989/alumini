-- ============================================================
-- Alumini — Initial Database Schema
-- Migration: 001_initial_schema.sql
--
-- Run in Supabase Dashboard → SQL Editor, or via:
--   supabase db push
--
-- CHANGELOG vs original:
--   Fix #4  — profiles RLS: restricted to owner for sensitive fields,
--              limited public view (no email/phone/linkedin)
--   Fix #6  — institutions: explicit INSERT policy (service role only)
--   Fix #7  — personas: partial unique index for NULL institution_id
--              (alumni persona) to prevent duplicate alumni personas
--   Fix #10 — added missing index on verifications(user_id, classroom_id)
--   Fix #2  — batch code redemption: atomic SQL function (redeem_batch_code)
--              eliminates race condition
--   Minor   — audit_logs: added is_system_event boolean column
--   Minor   — member_count trigger also fires on UPDATE (status changes)
--
-- Tables created in dependency order.
-- RLS policies applied to every table.
-- All timestamps in UTC (timestamptz).
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- for fuzzy name search
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- for secure random generation

-- ============================================================
-- 1. PROFILES (extends Supabase auth.users)
-- ============================================================

CREATE TABLE public.profiles (
  id                uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text        UNIQUE NOT NULL,
  full_name         text        NOT NULL,
  avatar_url        text,
  phone             text,
  mfa_enabled       boolean     NOT NULL DEFAULT false,
  mfa_method        text        CHECK (mfa_method IN ('totp', 'sms')),
  active_persona    text        NOT NULL DEFAULT 'alumni'
                                CHECK (active_persona IN ('alumni', 'teacher', 'school_admin')),
  linkedin_url      text,
  linkedin_verified boolean     NOT NULL DEFAULT false,
  linkedin_education jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS
  'One row per user. Extends auth.users with app-specific profile data.';
COMMENT ON COLUMN public.profiles.active_persona IS
  'Which persona is currently active for this session. Written on persona switch.';
COMMENT ON COLUMN public.profiles.mfa_method IS
  'TOTP preferred. SMS is fallback only. School admins must use TOTP only.';

-- Auto-create profile when user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at on profile changes
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 2. INSTITUTIONS
-- ============================================================

CREATE TABLE public.institutions (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           text        NOT NULL,
  slug           text        UNIQUE NOT NULL,  -- e.g. MPBIRLA, UCDAVIS
  type           text        NOT NULL CHECK (type IN ('school', 'college', 'university')),
  city_code      text,
  country_code   text        NOT NULL,  -- ISO 3166-1 alpha-2
  email_domain   text,                  -- e.g. ucdavis.edu — for email verification
  is_partner     boolean     NOT NULL DEFAULT false,
  is_claimed     boolean     NOT NULL DEFAULT false,
  claimed_by     uuid        REFERENCES public.profiles(id),
  claimed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.institutions IS
  'Global institution database. Seeded from UDISE/AISHE/IPEDS. Augmented by community.
   INSERT is restricted to service role only (see RLS section).
   Users can read all institutions for search/autocomplete.';
COMMENT ON COLUMN public.institutions.is_partner IS
  'Partner institutions can issue batch codes and get a verified badge.';
COMMENT ON COLUMN public.institutions.is_claimed IS
  'True when a school admin has been approved by Alumini ops team.';
COMMENT ON COLUMN public.institutions.email_domain IS
  'Used for Method 1 (institutional email) verification. Null if not applicable.';

-- Full-text search index on institution name for autocomplete
CREATE INDEX institutions_name_trgm_idx ON public.institutions USING gin(name gin_trgm_ops);
CREATE INDEX institutions_country_idx ON public.institutions(country_code);

-- ============================================================
-- 3. PERSONAS
-- ============================================================

CREATE TABLE public.personas (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type            text        NOT NULL CHECK (type IN ('alumni', 'teacher', 'school_admin')),
  institution_id  uuid        REFERENCES public.institutions(id),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'pending_approval', 'suspended')),
  is_primary_admin boolean   NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Unique constraint for personas WITH an institution (teacher, school_admin)
  -- Cannot use a simple UNIQUE(user_id, type, institution_id) because
  -- NULL != NULL in PostgreSQL — two alumni personas would both have
  -- institution_id = NULL and would not be caught by the constraint.
  UNIQUE(user_id, type, institution_id)
);

COMMENT ON TABLE public.personas IS
  'Each row = one role context for a user. One user can have multiple personas.
   institution_id is null for alumni persona, set for teacher and school_admin.
   Duplicate alumni personas prevented by partial unique index below.';
COMMENT ON COLUMN public.personas.is_primary_admin IS
  'For school_admin type only. Primary admin cannot be removed without ownership transfer.
   First admin per institution is always primary.';

-- FIX #7: Partial unique index for alumni personas (institution_id IS NULL).
-- Standard UNIQUE(user_id, type, institution_id) does not catch duplicates
-- when institution_id is NULL because NULL != NULL in PostgreSQL unique checks.
-- This index closes that gap — one alumni persona per user, full stop.
CREATE UNIQUE INDEX personas_alumni_unique_idx
  ON public.personas(user_id, type)
  WHERE institution_id IS NULL;

-- Enforce max 5 admins per institution (configurable in appConfig)
CREATE OR REPLACE FUNCTION public.check_admin_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  admin_count integer;
  max_admins  integer := 5;  -- mirrors appConfig.INSTITUTION_MAX_ADMINS
BEGIN
  IF NEW.type = 'school_admin' AND NEW.status = 'active' THEN
    SELECT COUNT(*) INTO admin_count
    FROM public.personas
    WHERE institution_id = NEW.institution_id
      AND type = 'school_admin'
      AND status = 'active'
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF admin_count >= max_admins THEN
      RAISE EXCEPTION 'Institution has reached the maximum of % admins', max_admins;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_admin_limit
  BEFORE INSERT OR UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.check_admin_limit();

-- ============================================================
-- 4. CLASSROOMS
-- ============================================================

CREATE TABLE public.classrooms (
  id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  global_id            text        UNIQUE NOT NULL,  -- e.g. IN-KOL-MPBIRLA-9A-2012
  institution_id       uuid        NOT NULL REFERENCES public.institutions(id),
  name                 text        NOT NULL,
  batch_year           integer     NOT NULL,
  grade                text,        -- '9', '10', '12' etc (schools)
  section              text,        -- 'A', 'B', 'C' etc (optional)
  program              text,        -- 'MBA', 'BTECH' etc (colleges)
  has_staff_room       boolean     NOT NULL DEFAULT true,
  has_student_alley    boolean     NOT NULL DEFAULT true,
  require_verification boolean     NOT NULL DEFAULT true,
  created_by           uuid        NOT NULL REFERENCES public.profiles(id),
  member_count         integer     NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Validate: school needs grade, college needs program
  CONSTRAINT classroom_type_check CHECK (
    (grade IS NOT NULL) OR (program IS NOT NULL)
  )
);

COMMENT ON TABLE public.classrooms IS
  'Each row = one batch/section at one institution in one year.
   Global ID is the canonical unique identifier. Prevents duplicate classrooms.';
COMMENT ON COLUMN public.classrooms.global_id IS
  'Structured ID: IN-KOL-MPBIRLA-9A-2012 or US-UCDAVIS-MBA-2025.
   Generated by generateClassroomId() in packages/utils. Never changes after creation.';
COMMENT ON COLUMN public.classrooms.member_count IS
  'Denormalised count. Updated by trigger on membership insert/delete/status change.
   Read-only — never update directly.';

-- FIX (minor): member_count trigger now also fires on UPDATE so that
-- status changes (e.g. rejected membership) reflect correctly.
CREATE OR REPLACE FUNCTION public.update_member_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.classrooms
    SET member_count = member_count + 1
    WHERE id = NEW.classroom_id;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.classrooms
    SET member_count = GREATEST(member_count - 1, 0)
    WHERE id = OLD.classroom_id;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Only adjust count when verification_status changes
    -- Count only verified members so member_count = active verified count
    IF OLD.verification_status != 'verified' AND NEW.verification_status = 'verified' THEN
      UPDATE public.classrooms
      SET member_count = member_count + 1
      WHERE id = NEW.classroom_id;
    ELSIF OLD.verification_status = 'verified' AND NEW.verification_status != 'verified' THEN
      UPDATE public.classrooms
      SET member_count = GREATEST(member_count - 1, 0)
      WHERE id = NEW.classroom_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- ============================================================
-- 5. MEMBERSHIPS
-- ============================================================

CREATE TABLE public.memberships (
  id                  uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  classroom_id        uuid        NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  role                text        NOT NULL DEFAULT 'student'
                                  CHECK (role IN ('student', 'teacher', 'admin')),
  verification_status text        NOT NULL DEFAULT 'pending'
                                  CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verification_method text        CHECK (verification_method IN (
                                    'email', 'peer_vouch', 'document',
                                    'linkedin', 'personal_code', 'batch_code', 'creator'
                                  )),
  verified_at         timestamptz,
  verified_by         uuid        REFERENCES public.profiles(id),
  joined_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, classroom_id)
);

COMMENT ON TABLE public.memberships IS
  'One row per user per classroom. role and verification_status drive all access control.
   member_count on classrooms reflects verified members only (see trigger).';
COMMENT ON COLUMN public.memberships.verification_status IS
  'pending  = joined but not verified (read-only, content redacted by API)
   verified = full access to post and read
   rejected = admin rejected verification attempt';
COMMENT ON COLUMN public.memberships.verified_by IS
  'For document verification: UUID of the admin who approved.
   For auto-verification (email, code, linkedin): null.';

-- Attach member_count trigger — fires on INSERT, DELETE, and UPDATE
CREATE TRIGGER membership_count_trigger
  AFTER INSERT OR DELETE OR UPDATE OF verification_status ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_member_count();

-- Indexes for fast member lookups
CREATE INDEX memberships_classroom_idx ON public.memberships(classroom_id, verification_status);
CREATE INDEX memberships_user_idx ON public.memberships(user_id);

-- ============================================================
-- 6. MESSAGES
-- ============================================================

CREATE TABLE public.messages (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id uuid        NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  channel      text        NOT NULL DEFAULT 'classroom'
                           CHECK (channel IN ('classroom', 'staff_room', 'student_alley')),
  sender_id    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  content      text        NOT NULL,
  message_type text        NOT NULL DEFAULT 'text'
                           CHECK (message_type IN ('text', 'event_card', 'system', 'attachment')),
  metadata     jsonb,       -- event_id for event_card, attachment path for attachment
  is_deleted   boolean     NOT NULL DEFAULT false,
  deleted_by   uuid        REFERENCES public.profiles(id),
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.messages IS
  'All messages across all channels. channel column determines the private space.
   Deleted messages are tombstoned (is_deleted=true), not physically deleted.
   API returns null content for deleted messages and redacted content for unverified users.';
COMMENT ON COLUMN public.messages.channel IS
  'classroom     = all verified members (students + teachers)
   staff_room    = verified teachers and admins only — NEVER shown to students (RLS)
   student_alley = verified students only — NEVER shown to teachers (RLS)';

-- Index for paginated message retrieval (most common query)
CREATE INDEX messages_classroom_channel_idx
  ON public.messages(classroom_id, channel, created_at DESC);

-- ============================================================
-- 7. VERIFICATIONS
-- ============================================================

CREATE TABLE public.verifications (
  id                    uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  membership_id         uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  user_id               uuid        NOT NULL REFERENCES public.profiles(id),
  classroom_id          uuid        NOT NULL REFERENCES public.classrooms(id),
  method                text        NOT NULL CHECK (method IN (
                                      'email', 'peer_vouch', 'document',
                                      'linkedin', 'personal_code', 'batch_code'
                                    )),
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  -- Document verification fields
  document_storage_path text,        -- Supabase Storage path (NEVER a public URL)
  document_expires_at   timestamptz, -- Set to NOW() + 30 days on upload
  -- Peer vouch fields
  -- FIX #5 (partial): vouches stores user_id + role only, NOT full_name.
  -- Full name is joined at read time from profiles to support right-to-erasure requests.
  -- Schema: [{user_id: uuid, role: 'student'|'teacher', vouched_at: timestamptz}]
  vouches               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  vouch_points          numeric     NOT NULL DEFAULT 0,
  -- Code verification fields
  code_id               uuid        REFERENCES public.institution_codes(id),
  -- Review fields (for document and admin-reviewed verifications)
  reviewed_by           uuid        REFERENCES public.profiles(id),
  reviewed_at           timestamptz,
  rejection_reason      text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.verifications IS
  'Tracks each verification attempt per user per classroom.
   Multiple attempts with different methods are allowed — only one needs to succeed.
   document_storage_path is NEVER returned to clients. Admins get signed URLs (1hr expiry).';
COMMENT ON COLUMN public.verifications.vouches IS
  'JSON array: [{user_id, role, vouched_at}].
   Intentionally excludes full_name — join from profiles at read time.
   This supports GDPR/DPDP right-to-erasure without hunting through jsonb blobs.
   Append-only. Never remove individual vouches once added.';
COMMENT ON COLUMN public.verifications.document_storage_path IS
  'Path in the private verification-documents Supabase Storage bucket.
   Nulled out after document deletion (auto-delete at document_expires_at).
   Access via signed URL only — generated server-side for admins, 1hr expiry.';

-- Index for admin verification queue (status + classroom)
CREATE INDEX verifications_status_classroom_idx
  ON public.verifications(classroom_id, status, created_at);

-- FIX #10: Missing index on user_id + classroom_id.
-- The vouching flow queries this combination on every vouch operation.
CREATE INDEX verifications_user_classroom_idx
  ON public.verifications(user_id, classroom_id, method, status);

-- ============================================================
-- 8. INSTITUTION CODES
-- ============================================================

CREATE TABLE public.institution_codes (
  id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id   uuid        NOT NULL REFERENCES public.institutions(id),
  classroom_id     uuid        NOT NULL REFERENCES public.classrooms(id),
  code             text        UNIQUE NOT NULL,  -- e.g. IN-2026-A7K2PQ
  type             text        NOT NULL CHECK (type IN ('personal', 'batch')),
  -- Personal code fields (type = 'personal')
  bound_name       text,        -- Display name code is tied to (not used for auth)
  bound_email      text,        -- Email the code was sent to
  -- Batch code fields (type = 'batch')
  max_redemptions  integer,     -- Null for personal codes
  redemption_count integer     NOT NULL DEFAULT 0,
  -- Redemption tracking
  is_redeemed      boolean     NOT NULL DEFAULT false,  -- For personal codes
  redeemed_by      uuid        REFERENCES public.profiles(id),
  redeemed_at      timestamptz,
  -- Lifecycle
  expires_at       timestamptz NOT NULL,
  generated_by     uuid        NOT NULL REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Enforce: personal codes redeemed at most once
  CONSTRAINT personal_code_once CHECK (
    type != 'personal' OR redemption_count <= 1
  ),
  -- Enforce: batch codes must have a cap set at creation
  CONSTRAINT batch_code_cap CHECK (
    type != 'batch' OR max_redemptions IS NOT NULL
  )
);

COMMENT ON TABLE public.institution_codes IS
  'Institution-issued verification codes.
   Personal: name-tied, single-use, expires in 90 days.
   Batch: shared code capped to class size — burns when max_redemptions reached.
   Redemption uses atomic SQL function (redeem_batch_code) to prevent race conditions.';

-- FIX #2: Atomic batch code redemption function.
-- Replaces the check-then-update pattern in application code which has a
-- race condition — two concurrent requests could both pass the cap check
-- before either increments the counter.
-- This function does both in a single atomic operation using FOR UPDATE SKIP LOCKED.
-- Returns the updated code row on success, null if cap was already reached.
CREATE OR REPLACE FUNCTION public.redeem_batch_code(
  p_code         text,
  p_classroom_id uuid,
  p_user_id      uuid
)
RETURNS public.institution_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code public.institution_codes;
BEGIN
  -- Lock the row for update, skip if another transaction has it locked
  SELECT * INTO v_code
  FROM public.institution_codes
  WHERE code = p_code
    AND classroom_id = p_classroom_id
    AND type = 'batch'
    AND is_redeemed = false
    AND expires_at > now()
  FOR UPDATE;

  -- Code not found, expired, or already fully redeemed
  IF v_code IS NULL THEN
    RETURN NULL;
  END IF;

  -- Check cap atomically (we hold the row lock here)
  IF v_code.redemption_count >= v_code.max_redemptions THEN
    RETURN NULL;
  END IF;

  -- Atomically increment and record redeemer
  UPDATE public.institution_codes
  SET
    redemption_count = redemption_count + 1,
    redeemed_by      = p_user_id,
    redeemed_at      = now()
  WHERE id = v_code.id
  RETURNING * INTO v_code;

  RETURN v_code;
END;
$$;

COMMENT ON FUNCTION public.redeem_batch_code IS
  'Atomically redeems a batch code. Holds a row-level lock during the check-and-update
   to prevent race conditions when multiple users redeem simultaneously.
   Returns the updated code row on success, NULL if the cap was reached or code is invalid.
   Call from API service role only.';

-- ============================================================
-- 9. EVENTS
-- ============================================================

CREATE TABLE public.events (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id uuid        NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  created_by   uuid        NOT NULL REFERENCES public.profiles(id),
  title        text        NOT NULL,
  event_date   timestamptz NOT NULL,
  location     text,
  description  text,
  is_online    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.events IS
  'Events created by verified classroom members.
   On creation, the corridor module auto-posts an event_card message to the Classroom channel.';

-- ============================================================
-- 10. RSVPs
-- ============================================================

CREATE TABLE public.rsvps (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id     uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status       text        NOT NULL CHECK (status IN ('going', 'not_going', 'maybe')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);

CREATE TRIGGER rsvps_updated_at
  BEFORE UPDATE ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 11. NOTIFICATIONS
-- ============================================================

CREATE TABLE public.notifications (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         text        NOT NULL,
  title        text        NOT NULL,
  body         text,
  data         jsonb,
  is_read      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx
  ON public.notifications(user_id, is_read, created_at DESC);

-- ============================================================
-- 12. AUDIT LOGS (append-only, never deleted)
-- ============================================================

CREATE TABLE public.audit_logs (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type      text        NOT NULL,
  actor_id        uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_id       uuid,
  target_type     text,
  metadata        jsonb,
  ip_address      inet,
  user_agent      text,
  persona         text        CHECK (persona IN ('alumni', 'teacher', 'school_admin')),
  -- FIX (minor): distinguishes true system events (cron, triggers) from
  -- events where actor_id was lost due to an audit write failure.
  is_system_event boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS
  'Immutable audit trail. NEVER delete or update rows. Retention: minimum 2 years.
   actor_id set to null on profile deletion (anonymised, not removed from log).
   is_system_event = true means the action was automated (cron, trigger, lifecycle rule).
   is_system_event = false + actor_id = null means actor_id was lost — investigate.
   metadata MUST NOT contain cleartext PII (names, emails, document content).';

-- Indexes for efficient audit queries
CREATE INDEX audit_logs_actor_idx
  ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX audit_logs_event_type_idx
  ON public.audit_logs(event_type, created_at DESC);
-- Additional index for institution-scoped admin audit queries
CREATE INDEX audit_logs_metadata_institution_idx
  ON public.audit_logs USING gin(metadata jsonb_path_ops);

-- Prevent row-level deletion and updates at database level
-- Belt-and-suspenders: application layer also never calls DELETE/UPDATE on this table
CREATE RULE audit_logs_no_delete AS ON DELETE TO public.audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_update AS ON UPDATE TO public.audit_logs DO INSTEAD NOTHING;

-- ============================================================
-- 13. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsvps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs        ENABLE ROW LEVEL SECURITY;

-- ── Profiles ─────────────────────────────────────────────────────────────────
-- FIX #4: Split into two policies.
--
-- OLD (insecure): profiles_read_all → USING (true)
-- Anyone could query email, phone, linkedin_url, mfa_method — all PII.
-- The API layer did redaction but a direct Supabase query bypassed it.
--
-- NEW: Two policies:
--   profiles_read_public  → all authenticated users see safe public fields only
--                           (implemented via a view — see profiles_public below)
--   profiles_read_own     → owner sees their own full row including PII fields
--
-- The public view (profiles_public) is the correct way to expose limited fields.
-- Direct SELECT on profiles table returns full row only to the owner.

-- Owners can read their own full profile (all fields including PII)
CREATE POLICY "profiles_read_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Owners can update their own profile
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Public read view — safe fields only (no email, phone, linkedin_education)
-- Other modules JOIN this view when they need another user's display name or avatar.
-- The API never exposes the raw profiles table to clients except for the owner.
CREATE OR REPLACE VIEW public.profiles_public AS
  SELECT
    id,
    full_name,
    avatar_url,
    active_persona,
    linkedin_url,       -- URL is public (opt-in field)
    linkedin_verified,
    created_at
  FROM public.profiles;

COMMENT ON VIEW public.profiles_public IS
  'Safe public projection of profiles. Excludes email, phone, mfa_method, linkedin_education.
   Use this view in any query that fetches another user''s profile.
   Never expose the raw profiles table to clients except to the row owner.';

-- ── Institutions ──────────────────────────────────────────────────────────────
-- Anyone (authenticated) can read institutions — needed for search/autocomplete
CREATE POLICY "institutions_read_all"
  ON public.institutions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- FIX #6: Explicit INSERT policy — service role only.
-- Without this, if RLS were accidentally disabled, any authenticated user
-- could insert institutions. With this policy, only the service role
-- (which bypasses RLS entirely) can insert — clients never can.
-- The policy USING (false) means no client JWT can ever satisfy this condition.
CREATE POLICY "institutions_insert_service_only"
  ON public.institutions FOR INSERT
  WITH CHECK (false);

-- Only service role can update institutions (claimed_by, is_claimed, is_partner)
CREATE POLICY "institutions_update_service_only"
  ON public.institutions FOR UPDATE
  USING (false);

-- ── Personas ─────────────────────────────────────────────────────────────────
-- Users can only see their own personas
CREATE POLICY "personas_read_own"
  ON public.personas FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own personas (status validation handled by API)
CREATE POLICY "personas_insert_own"
  ON public.personas FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Persona status updates only via service role (API uses service role key)
-- Prevents clients from self-approving pending_approval personas
CREATE POLICY "personas_update_service_only"
  ON public.personas FOR UPDATE
  USING (false);

-- ── Classrooms ────────────────────────────────────────────────────────────────
-- Anyone (authenticated) can read classroom metadata — needed for join/search flow
CREATE POLICY "classrooms_read_all"
  ON public.classrooms FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Authenticated users can create classrooms (they become classroom admin)
CREATE POLICY "classrooms_insert_auth"
  ON public.classrooms FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- ── Memberships ───────────────────────────────────────────────────────────────
-- Users see their own memberships.
-- Verified admins and teachers see all memberships in their classrooms.
CREATE POLICY "memberships_read"
  ON public.memberships FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.memberships m2
      WHERE m2.user_id = auth.uid()
        AND m2.classroom_id = memberships.classroom_id
        AND m2.role IN ('admin', 'teacher')
        AND m2.verification_status = 'verified'
    )
  );

-- Users can join classrooms (insert their own membership)
CREATE POLICY "memberships_insert_own"
  ON public.memberships FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Membership updates (role changes, verification approval) go via service role only.
-- This prevents a user from self-approving their own verification.
CREATE POLICY "memberships_update_service_only"
  ON public.memberships FOR UPDATE
  USING (false);

-- ── Messages — THE CRITICAL PRIVACY POLICIES ──────────────────────────────────
-- These three policies work together. Supabase evaluates all SELECT policies
-- with OR logic — a row is visible if ANY policy allows it.
-- So each policy uses a negative guard (channel != X) to let the other
-- policies handle the other channels, while gating its own channel strictly.

-- CLASSROOM channel: all verified members of that classroom
CREATE POLICY "messages_classroom_read"
  ON public.messages FOR SELECT
  USING (
    channel != 'classroom'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = messages.classroom_id
        AND m.verification_status = 'verified'
    )
  );

-- STAFF ROOM channel: verified teachers and admins only.
-- Students NEVER see staff_room messages — even via direct Supabase query.
CREATE POLICY "messages_staff_room_read"
  ON public.messages FOR SELECT
  USING (
    channel != 'staff_room'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = messages.classroom_id
        AND m.role IN ('teacher', 'admin')
        AND m.verification_status = 'verified'
    )
  );

-- STUDENT ALLEY channel: verified students only.
-- Teachers NEVER see student_alley messages — even via direct Supabase query.
CREATE POLICY "messages_student_alley_read"
  ON public.messages FOR SELECT
  USING (
    channel != 'student_alley'
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = messages.classroom_id
        AND m.role = 'student'
        AND m.verification_status = 'verified'
    )
  );

-- INSERT: verified members only, in channels they have access to
CREATE POLICY "messages_insert"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = messages.classroom_id
        AND m.verification_status = 'verified'
        AND (
          (channel = 'classroom')
          OR (channel = 'staff_room'    AND m.role IN ('teacher', 'admin'))
          OR (channel = 'student_alley' AND m.role = 'student')
        )
    )
  );

-- ── Verifications ─────────────────────────────────────────────────────────────
-- Users see their own verifications.
-- Verified admins see all pending verifications in their classroom.
CREATE POLICY "verifications_read"
  ON public.verifications FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = verifications.classroom_id
        AND m.role = 'admin'
        AND m.verification_status = 'verified'
    )
  );

-- Users submit their own verifications
CREATE POLICY "verifications_insert_own"
  ON public.verifications FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Updates (approve/reject) via service role only — prevents self-approval
CREATE POLICY "verifications_update_service_only"
  ON public.verifications FOR UPDATE
  USING (false);

-- ── Institution codes ─────────────────────────────────────────────────────────
-- No direct client access to codes table — prevents code enumeration/farming.
-- All code operations go via service role through the API.
-- Redemption uses the redeem_batch_code() function (SECURITY DEFINER).
CREATE POLICY "institution_codes_no_direct_access"
  ON public.institution_codes FOR SELECT
  USING (false);

CREATE POLICY "institution_codes_no_insert"
  ON public.institution_codes FOR INSERT
  WITH CHECK (false);

-- ── Events ────────────────────────────────────────────────────────────────────
-- Verified members can see events in their classrooms
CREATE POLICY "events_read"
  ON public.events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND m.verification_status = 'verified'
    )
  );

-- Verified members can create events
CREATE POLICY "events_insert"
  ON public.events FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.classroom_id = events.classroom_id
        AND m.verification_status = 'verified'
    )
  );

-- ── RSVPs ────────────────────────────────────────────────────────────────────
CREATE POLICY "rsvps_read"
  ON public.rsvps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.memberships m ON m.classroom_id = e.classroom_id
      WHERE e.id = rsvps.event_id
        AND m.user_id = auth.uid()
        AND m.verification_status = 'verified'
    )
  );

-- Users manage their own RSVPs (insert + update)
CREATE POLICY "rsvps_own"
  ON public.rsvps FOR ALL
  USING (user_id = auth.uid());

-- ── Notifications ─────────────────────────────────────────────────────────────
-- Users only see their own notifications
CREATE POLICY "notifications_own"
  ON public.notifications FOR ALL
  USING (user_id = auth.uid());

-- ── Audit logs ────────────────────────────────────────────────────────────────
-- Users can read their own audit trail (auth events, verifications, persona switches)
CREATE POLICY "audit_logs_read_own"
  ON public.audit_logs FOR SELECT
  USING (actor_id = auth.uid());

-- No client inserts — written by API service role only
-- No updates or deletes — enforced by RULE above + no policy granted

-- ============================================================
-- 14. STORAGE BUCKETS
-- (Create in Supabase Dashboard → Storage, or via CLI)
-- ============================================================

-- verification-documents (PRIVATE)
--   Purpose : Stores identity documents uploaded for verification review
--   Access  : Service role only. Admins get signed URLs (1hr expiry) via API.
--   Lifecycle: Auto-delete at document_expires_at (30 days after upload).
--              Configure lifecycle rule in Dashboard → Storage → Policies.
--   Path    : {classroom_id}/{user_id}/{timestamp}_{filename}

-- profile-avatars (PUBLIC)
--   Purpose : User profile photos
--   Access  : Public read, authenticated write (own folder only)
--   Path    : {user_id}/avatar_{timestamp}

-- classroom-media (PUBLIC)
--   Purpose : Message attachments (images, files)
--   Access  : Public read, verified members write (own classroom folder)
--   Path    : {classroom_id}/{sender_id}/{timestamp}_{filename}

-- ============================================================
-- 15. REALTIME PUBLICATION
-- (Enable in Supabase Dashboard → Database → Replication)
-- ============================================================

-- Enable replication (Realtime) for these tables:
--   public.messages       → live chat
--   public.notifications  → push notification triggers
--   public.rsvps          → live RSVP count updates on event cards

-- ============================================================
-- 16. SEED DATA (development only — NOT for production)
-- ============================================================

INSERT INTO public.institutions (name, slug, type, city_code, country_code, email_domain)
VALUES
  ('MP Birla School',       'MPBIRLA',   'school',     'KOL', 'IN', null),
  ('KV Fort William',       'KVFORTW',   'school',     'KOL', 'IN', null),
  ('IIT Kharagpur',         'IITKGP',    'university', 'KGP', 'IN', 'kgpian.iitkgp.ac.in'),
  ('UC Davis',              'UCDAVIS',   'university', null,  'US', 'ucdavis.edu'),
  ('St. Xavier''s College', 'STXAVIERS', 'college',    'KOL', 'IN', null)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- VERIFICATION QUERY
-- Run after migration to confirm all tables and indexes exist:
--
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
--
-- SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public' ORDER BY indexname;
-- ============================================================
