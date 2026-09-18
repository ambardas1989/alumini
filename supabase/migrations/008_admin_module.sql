-- ============================================================
-- Alumini — Admin Module: platform admin flag
-- Migration: 008_admin_module.sql
--
-- AdminModule adds no tables of its own — it aggregates data from
-- institutions, classrooms, memberships, verifications, personas, and
-- institution_codes (all already owned by other modules) via direct
-- Supabase queries, per its own module comment. The one thing it needs
-- that didn't already exist is a way to identify SPEC.md §3.4's "Alumini
-- Internal (Platform Admin)" — distinct from a school_admin persona, which
-- is scoped to one institution.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_platform_admin IS
  'SPEC.md §3.4: Alumini''s own internal ops team, not scoped to any one
   institution (unlike personas.type=''school_admin''). Gates institution
   claim approval/rejection (AdminService.assertPlatformAdmin()).
   No self-serve endpoint sets this column — it is granted by direct
   database access only (e.g. Supabase Studio), matching §3.4''s "Access
   controlled via Supabase service role — never exposed to users."
   KNOWN CONSIDERATION: the pre-existing profiles_update_own RLS policy
   (001_initial_schema.sql) is USING-only (auth.uid() = id) with no
   column-level WITH CHECK restriction, so it does not itself prevent a
   user updating their own row from also setting is_platform_admin=true —
   this has never been exploitable through this API (every profile-update
   endpoint whitelists specific columns; see IdentityService.updateProfile()),
   but a direct Supabase client with a user''s own JWT could theoretically
   reach it. Flagged here as a follow-up hardening candidate (e.g. a
   trigger rejecting changes to this column from a non-service-role
   session) rather than rewritten silently as part of this migration.';
