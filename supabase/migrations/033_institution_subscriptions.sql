-- TASKS_11 TASK 04 — institution subscription (Tier 3) status tracking.
-- No payment processing here — same "status tracking only, no payment
-- processor" scope PremiumService already documents for per-user premium
-- (007_premium_module.sql); a future Razorpay/Stripe integration would
-- write to this table the same way it would to premium_subscriptions.
--
-- Must be run manually in the Supabase SQL Editor — this repo's
-- migrations are not auto-applied on deploy (see
-- supabase/migrations/README.md).

CREATE TABLE IF NOT EXISTS public.institution_subscriptions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  institution_id uuid REFERENCES public.institutions(id)
    ON DELETE CASCADE UNIQUE,
  plan text CHECK (plan IN ('free', 'tier3'))
    DEFAULT 'free',
  status text CHECK (status IN (
    'active', 'inactive', 'trial', 'cancelled'
  )) DEFAULT 'inactive',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  max_classrooms integer DEFAULT 5,
  max_members_per_classroom integer DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.institution_subscriptions IS
  'One row per institution, created on first GET if missing. plan=free/status=inactive is the implicit default for an institution with no row yet — InstitutionService.getSubscription() returns that shape without needing to pre-create a row for every institution.';
