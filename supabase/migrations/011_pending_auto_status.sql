-- TASK 04 — Creator and early member verification badges
--
-- Cold start fix: a brand new classroom has no verified members yet to
-- vouch for early joiners, so the first few joiners would otherwise be
-- stuck read-only (SPEC.md §7.4) indefinitely. 'pending_auto' is a
-- distinct status from 'pending' — it still shows the "complete
-- verification" nudge, but is treated as verified for messaging access
-- (see the messages_insert policy update below) so the classroom isn't
-- silent while it's new.

ALTER TABLE public.memberships
DROP CONSTRAINT IF EXISTS memberships_verification_status_check;

ALTER TABLE public.memberships
ADD CONSTRAINT memberships_verification_status_check
CHECK (verification_status IN (
  'pending', 'pending_auto', 'verified', 'rejected'
));

-- 'early_member' is the verification_method paired with 'pending_auto' —
-- the original CHECK (001_initial_schema.sql) predates this status and
-- would otherwise reject it.
ALTER TABLE public.memberships
DROP CONSTRAINT IF EXISTS memberships_verification_method_check;

ALTER TABLE public.memberships
ADD CONSTRAINT memberships_verification_method_check
CHECK (verification_method IN (
  'email', 'peer_vouch', 'document',
  'linkedin', 'personal_code', 'batch_code', 'creator', 'early_member'
));

-- Allow pending_auto members to post in classroom and student_alley
-- channels (same channels an unverified member could already read in
-- redacted form) — staff_room stays verified-only regardless of role.
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
    AND m.classroom_id = messages.classroom_id
    AND m.verification_status IN ('verified', 'pending_auto')
    AND (
      messages.channel IN ('classroom', 'student_alley')
      OR (messages.channel = 'staff_room'
        AND m.role IN ('teacher', 'admin')
        AND m.verification_status = 'verified')
    )
  )
);
