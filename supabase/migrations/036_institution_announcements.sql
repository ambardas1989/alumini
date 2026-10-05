-- TASKS_11 TASK 08 — institution-wide announcements.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

CREATE TABLE IF NOT EXISTS public.institution_announcements (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  institution_id uuid REFERENCES public.institutions(id)
    ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id),
  title text NOT NULL,
  body text NOT NULL,
  target text CHECK (target IN ('all', 'specific'))
    DEFAULT 'all',
  target_classroom_ids jsonb DEFAULT '[]'::jsonb,
  sent_at timestamptz DEFAULT now(),
  recipient_count integer DEFAULT 0
);

COMMENT ON TABLE public.institution_announcements IS
  'Read-only after send — no edit route exists. Delivery is via NotificationService.sendInApp()/sendPush() per recipient (institution.announcement.sent event), not a separate feed_item table — this schema has none (see notification.service.ts''s own module comment).';

CREATE INDEX IF NOT EXISTS institution_announcements_institution_idx
ON public.institution_announcements(institution_id);

ALTER TABLE public.institution_announcements
ENABLE ROW LEVEL SECURITY;

-- NOTE: p.type stores lowercase values per personas' own CHECK constraint
-- (001_initial_schema.sql: CHECK (type IN ('alumni', 'teacher',
-- 'school_admin'))) — 'school_admin', not 'SCHOOL_ADMIN'.
CREATE POLICY "institution_announcements_admin"
ON public.institution_announcements FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.personas p
    WHERE p.user_id = auth.uid()
    AND p.institution_id = institution_announcements.institution_id
    AND p.type = 'school_admin'
    AND p.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND is_platform_admin = true
  )
);
