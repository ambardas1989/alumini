-- TASKS_09 TASK 25 — adds 'visiting_city' to messages.message_type.
-- metadata jsonb already exists on public.messages (001_initial_schema.sql)
-- — no new column needed, only a widened CHECK.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE public.messages
ADD CONSTRAINT messages_message_type_check
CHECK (message_type IN ('text', 'event_card', 'system', 'attachment', 'announcement', 'visiting_city'));
