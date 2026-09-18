/**
 * PremiumService — feature-flag and payment-STATUS gating (SPEC.md §13).
 *
 * NOT A PAYMENT PROCESSOR. This module never talks to Razorpay or Stripe,
 * never handles a checkout flow, and never receives a webhook — it only
 * reads premium_subscriptions (007_premium_module.sql) and answers "is
 * this user premium right now". Razorpay/Stripe webhook handlers that
 * actually WRITE rows into that table (on purchase, renewal, cancellation)
 * are explicit future work — see the table's own migration comment. Until
 * that exists, subscription rows would need to be inserted by hand (e.g.
 * in Supabase Studio) for isPremium() to ever return true for a real user.
 *
 * EXPORTED so other modules can inject PremiumService and call
 * isPremium()/assertPremium() as a gate before their own premium-only
 * logic — e.g. a future reunion-planner or memory-capsule module would
 * call assertPremium() the same way corridor calls
 * MembershipService.canAccessChannel().
 *
 * "ACTIVE" IS CHECKED DEFENSIVELY: isPremium() doesn't trust a
 * status='active' row blindly — it also confirms expires_at is null or
 * still in the future. A renewal/cancellation webhook (future work) is
 * expected to flip status itself, but this guards against a subscription
 * that's simply gone stale before that job runs, the same "don't trust a
 * status flag alone" caution CodesService.computeStatus() applies to
 * institution codes.
 *
 * FEATURE_PREMIUM KILL SWITCH: when appConfig.FEATURE_PREMIUM is false,
 * isPremium() always returns false (so assertPremium() always throws,
 * cleanly disabling every premium-gated feature across the whole app), and
 * the two HTTP endpoints (GET /premium/status, /premium/features) return
 * 403 outright rather than a hollow "not premium" response — task's
 * explicit requirement, checked once in the controller via
 * assertFeatureEnabled() before either handler runs.
 */

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isExpired } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';

interface SubscriptionRow {
  status: 'active' | 'cancelled' | 'expired';
  plan: 'monthly' | 'annual';
  started_at: string | null;
  expires_at: string | null;
}

@Injectable()
export class PremiumService {
  private readonly logger = new Logger(PremiumService.name);
  private readonly supabase: SupabaseClient;

  constructor() {
    // Service role — bypasses RLS, same pattern as every other module.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Feature gate ─────────────────────────────────────────────────────────

  /**
   * The single source of truth for "does this user have premium right
   * now". Fails CLOSED — any DB error returns false rather than risking a
   * false positive on a feature gate.
   */
  async isPremium(userId: string): Promise<boolean> {
    if (!appConfig.FEATURE_PREMIUM) {
      return false;
    }

    const subscription = await this.getActiveSubscription(userId);
    return !!subscription;
  }

  /** Guard for other modules to call before premium-only logic — throws instead of returning a boolean. */
  async assertPremium(userId: string): Promise<void> {
    if (!(await this.isPremium(userId))) {
      throw new ForbiddenException('This feature requires an active premium subscription');
    }
  }

  // ── Storage tiers ────────────────────────────────────────────────────────

  async getStorageLimitMb(userId: string): Promise<number> {
    return (await this.isPremium(userId)) ? appConfig.STORAGE_PREMIUM_MB : appConfig.STORAGE_FREE_MB;
  }

  async getAttachmentLimitMb(userId: string): Promise<number> {
    return (await this.isPremium(userId))
      ? appConfig.ATTACHMENT_PREMIUM_MAX_MB
      : appConfig.ATTACHMENT_FREE_MAX_MB;
  }

  // ── HTTP-facing reads ────────────────────────────────────────────────────

  /** appConfig.FEATURE_PREMIUM's controller-level 403 (see module comment) — called by PremiumController before either handler. */
  assertFeatureEnabled(): void {
    if (!appConfig.FEATURE_PREMIUM) {
      throw new ForbiddenException('Premium features are currently disabled');
    }
  }

  async getStatus(userId: string) {
    const subscription = await this.getMostRecentSubscription(userId);
    const isPremiumNow = await this.isPremium(userId);

    return {
      isPremium: isPremiumNow,
      plan:      subscription?.plan ?? null,
      status:    subscription?.status ?? null,
      startedAt: subscription?.started_at ?? null,
      expiresAt: subscription?.expires_at ?? null,
    };
  }

  /**
   * Static, config-derived list — SPEC.md §13's feature table. Not
   * gated behind the caller's own premium status: SPEC.md §13's intro
   * ("Non-paying users see a locked preview with a clear unlock CTA")
   * means this list is precisely what a NON-premium user needs to see too.
   * `enabled` reflects whether the feature itself is built/toggled on
   * (appConfig flags), independent of any one user's subscription.
   */
  getFeatures() {
    return [
      {
        key: 'where_are_they_now',
        name: 'Where Are They Now',
        description: 'City, job, and company for batchmates who opt in',
        enabled: appConfig.FEATURE_WHERE_ARE_THEY_NOW,
      },
      {
        key: 'career_paths',
        name: 'Career paths',
        // SPEC.md §13: aggregated from the same self-reported "Where Are
        // They Now" data, so it shares that feature's flag rather than
        // having its own.
        description: 'Field breakdown for your batch (Tech, Medicine, Finance, ...)',
        enabled: appConfig.FEATURE_WHERE_ARE_THEY_NOW,
      },
      {
        key: 'reunion_planner',
        name: 'Reunion planner',
        description: 'RSVPs, location polls, and photo albums inside your classroom',
        enabled: true,
      },
      {
        key: 'memory_capsule',
        name: 'Memory capsule',
        description: 'Anniversary highlights surfacing old photos and messages',
        enabled: appConfig.FEATURE_MEMORY_CAPSULE,
      },
      {
        key: 'extra_storage',
        name: 'Extra storage',
        description: `${(appConfig.STORAGE_PREMIUM_MB / 1024).toFixed(0)}GB vs ${appConfig.STORAGE_FREE_MB}MB free`,
        enabled: true,
      },
    ];
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /** The active-and-unexpired subscription, or null — see the module comment on why "active" is re-checked against expires_at here. */
  private async getActiveSubscription(userId: string): Promise<SubscriptionRow | null> {
    const { data, error } = await this.supabase
      .from('premium_subscriptions')
      .select('status, plan, started_at, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      this.logger.error('Failed to check premium status', { error, userId });
      return null; // fail closed
    }

    const subscription = data?.[0] as SubscriptionRow | undefined;
    if (!subscription) return null;
    if (subscription.expires_at && isExpired(subscription.expires_at)) return null;

    return subscription;
  }

  /** Most recent subscription row regardless of status — for GET /premium/status, which should show a cancelled/expired plan too, not just an active one. */
  private async getMostRecentSubscription(userId: string): Promise<SubscriptionRow | null> {
    const { data, error } = await this.supabase
      .from('premium_subscriptions')
      .select('status, plan, started_at, expires_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      this.logger.error('Failed to load subscription history', { error, userId });
      return null;
    }

    return (data?.[0] as SubscriptionRow | undefined) ?? null;
  }
}
