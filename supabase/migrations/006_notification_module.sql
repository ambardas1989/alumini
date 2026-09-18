-- ============================================================
-- Alumini — Notification Module: FCM token column
-- Migration: 006_notification_module.sql
--
-- notifications (001_initial_schema.sql) already exists and is written to
-- directly by apps/backend/src/modules/notification — the same established
-- cross-module table-access pattern every module since auth has used.
--
-- This migration adds the one thing push notifications need that wasn't
-- already there: somewhere to store a device's FCM registration token.
-- SPEC.md's session model (sessions, 002_auth_module.sql) already
-- represents "one row per logged-in device", which is exactly the right
-- granularity for a push token — a user with multiple devices should get
-- pushed to all of them, not just their most recent login.
-- ============================================================

ALTER TABLE public.sessions
  ADD COLUMN fcm_token text;

COMMENT ON COLUMN public.sessions.fcm_token IS
  'Firebase Cloud Messaging registration token for this device/session,
   used by NotificationService.sendPush() to deliver push notifications.
   NULL until the client registers one. KNOWN GAP: no endpoint exists yet
   to set this column (e.g. a future PATCH /auth/session/fcm-token) — out
   of scope for the notification module itself, which only reads it.';

-- Push lookups filter to "active sessions with a token" — index the
-- combination NotificationService.sendPush() actually queries.
CREATE INDEX sessions_fcm_lookup_idx
  ON public.sessions(user_id, revoked_at)
  WHERE fcm_token IS NOT NULL;
