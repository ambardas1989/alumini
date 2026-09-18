-- ============================================================
-- Alumini — Premium Module Tables
-- Migration: 007_premium_module.sql
--
-- PremiumService never processes payments itself (SPEC.md §13 — Razorpay/
-- Stripe webhook handlers are explicitly future work, see
-- premium.service.ts's module comment). This table is the read model
-- those future webhook handlers will write to; for now it's written to
-- only by hand / a future admin tool, and read by PremiumService.isPremium()
-- and friends.
-- ============================================================

CREATE TABLE public.premium_subscriptions (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status            text        NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  plan              text        NOT NULL CHECK (plan IN ('monthly', 'annual')),
  price_inr         numeric,
  price_usd         numeric,
  started_at        timestamptz,
  expires_at        timestamptz,
  payment_provider  text,       -- 'razorpay' | 'stripe' — free text, not an enum: this
                                 -- table only records what a future payment integration
                                 -- reports, it doesn't validate provider-specific shape
  payment_reference text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.premium_subscriptions IS
  'One row per subscription period (a renewal inserts a new row rather than
   mutating the old one, preserving history) — a user can have multiple rows
   over time, at most one of which should be status=''active'' at a time.
   PremiumService.isPremium() treats status=''active'' AND (expires_at IS
   NULL OR expires_at > now()) as premium, defensively — see its own
   comment for why it does not trust status=''active'' alone.';

-- PremiumService.isPremium() always filters on (user_id, status) together,
-- then orders by created_at — index the combination it actually queries.
CREATE INDEX premium_subscriptions_user_status_idx
  ON public.premium_subscriptions(user_id, status, created_at DESC);

ALTER TABLE public.premium_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription only (task requirement).
CREATE POLICY "premium_subscriptions_read_own"
  ON public.premium_subscriptions FOR SELECT
  USING (user_id = auth.uid());

-- Service role writes only — no client can create or mutate a
-- subscription row, including their own. Payment webhook handlers (future
-- work) and the API's service-role client are the only writers.
CREATE POLICY "premium_subscriptions_insert_service_only"
  ON public.premium_subscriptions FOR INSERT
  WITH CHECK (false);

CREATE POLICY "premium_subscriptions_update_service_only"
  ON public.premium_subscriptions FOR UPDATE
  USING (false);
