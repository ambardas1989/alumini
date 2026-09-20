-- TASK 05 — Institution request flow
--
-- Schools/colleges must be approved by a platform admin before they appear
-- in search. Users request new ones here; POST /institution/:id/claim and
-- institution_admin_invites (both from 003_institution_module.sql) are a
-- DIFFERENT, later flow (claiming an institution that already exists) —
-- this table is upstream of that, for institutions that don't exist yet.

CREATE TABLE public.institution_requests (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  requested_by uuid REFERENCES public.profiles(id),
  name text NOT NULL,
  type text CHECK (type IN ('school','college','university')) NOT NULL,
  city text,
  city_code text,
  country_code text NOT NULL DEFAULT 'IN',
  website_url text,
  email_domain text,
  requester_relationship text CHECK (
    requester_relationship IN ('alumni','teacher','admin','other')
  ) NOT NULL,
  notes text,
  status text CHECK (
    status IN ('pending','approved','rejected')
  ) DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.institution_requests IS
  'A user-submitted request for an institution not yet in institutions. Reviewed by a platform admin (profiles.is_platform_admin) via POST /admin/institution-requests/:id/approve|reject.';

ALTER TABLE public.institution_requests ENABLE ROW LEVEL SECURITY;

-- Read/insert go through RLS for the requester's own rows; admin review
-- routes use the service-role client (bypasses RLS), same pattern as every
-- other admin-only table access in this codebase.
CREATE POLICY "institution_requests_read_own"
  ON public.institution_requests FOR SELECT
  USING (requested_by = auth.uid());

CREATE POLICY "institution_requests_insert"
  ON public.institution_requests FOR INSERT
  WITH CHECK (requested_by = auth.uid());
