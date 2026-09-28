-- TASKS_09 TASK 24 — adds 'announcement' to messages.message_type.
-- 001_initial_schema.sql's CHECK only allows
-- ('text', 'event_card', 'system', 'attachment') — no 'poll' type exists
-- anywhere in this codebase (the task's own note about "TASKS_08 poll
-- work" doesn't match this schema's actual history, so this widens the
-- existing constraint rather than assuming a poll value needs preserving).
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE public.messages
ADD CONSTRAINT messages_message_type_check
CHECK (message_type IN ('text', 'event_card', 'system', 'attachment', 'announcement'));
