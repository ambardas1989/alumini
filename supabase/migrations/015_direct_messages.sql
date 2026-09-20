-- TASK 06 (TASKS_03.md) — Direct messages
--
-- Simple 1:1 DM between verified members of the same classroom. No read
-- receipts beyond a single is_read flag, no typing indicators, no online
-- status. Must be run manually in Supabase SQL Editor.

CREATE TABLE public.direct_messages (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content      text NOT NULL CHECK (char_length(content) <= 2000),
  is_read      boolean NOT NULL DEFAULT false,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_message CHECK (sender_id != recipient_id)
);

CREATE INDEX dm_participants_idx ON public.direct_messages(
  LEAST(sender_id::text, recipient_id::text),
  GREATEST(sender_id::text, recipient_id::text),
  created_at DESC
);
CREATE INDEX dm_recipient_unread_idx ON public.direct_messages(
  recipient_id, is_read, created_at DESC
);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_read_participants"
  ON public.direct_messages FOR SELECT
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

CREATE POLICY "dm_insert_own"
  ON public.direct_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "dm_update_read"
  ON public.direct_messages FOR UPDATE
  USING (recipient_id = auth.uid());
