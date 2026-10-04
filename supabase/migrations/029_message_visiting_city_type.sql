-- TASKS_09 TASK 25 — adds 'visiting_city' to messages.message_type.
-- metadata jsonb already exists on public.messages (001_initial_schema.sql)
-- — no new column needed, only a widened CHECK.
--
-- TASKS_10 TASK 01 — also widened in place to add 'poll' (manually applied
-- to production on 2026-10-04, ahead of any app code that reads/writes
-- it — see TASKS_10.md's CONTEXT section). Re-running this file is still
-- idempotent (DROP CONSTRAINT IF EXISTS before each ADD CONSTRAINT), so
-- widening the same CHECK in place rather than adding a new migration
-- file matches the "closest existing file" instruction that task gave.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE public.messages
ADD CONSTRAINT messages_message_type_check
CHECK (message_type IN ('text', 'event_card', 'system', 'attachment', 'announcement', 'visiting_city', 'poll'));
