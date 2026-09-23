/**
 * Unit tests for PremiumService.
 *
 * Covers:
 * - isPremium(): FEATURE_PREMIUM kill switch, no subscription, active +
 *   unexpired, active but past expires_at (defensive check), DB error
 *   (fails closed)
 * - assertPremium(): throws vs resolves
 * - getStorageLimitMb()/getAttachmentLimitMb(): premium vs free values
 * - getStatus(): most recent subscription regardless of status, nulls
 *   when there's none
 * - getFeatures(): reflects the relevant appConfig flags
 * - assertFeatureEnabled(): the controller-level 403 gate
 *
 * appConfig is mocked (not the real singleton) specifically so
 * FEATURE_PREMIUM/FEATURE_MEMORY_CAPSULE can be toggled per test — every
 * other spec in this codebase uses the real appConfig because nothing
 * else needed to flip a flag at runtime.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';

const mockAppConfig = {
  FEATURE_PREMIUM: true,
  FEATURE_WHERE_ARE_THEY_NOW: true,
  FEATURE_MEMORY_CAPSULE: false,
  STORAGE_PREMIUM_MB: 2048,
  STORAGE_FREE_MB: 200,
  ATTACHMENT_PREMIUM_MAX_MB: 25,
  ATTACHMENT_FREE_MAX_MB: 5,
};

jest.mock('@alumini/config/app', () => ({ appConfig: mockAppConfig }));

import { PremiumService } from './premium.service';
import { AppLogger } from '../../common/logger/logger.service';

// ── Supabase mock (sequenced per table — see prior modules' specs for the same pattern) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'eq', 'order', 'limit'].forEach((method) => {
    builder[method] = jest.fn(() => builder);
  });
  builder.single = jest.fn(() => Promise.resolve(next()));
  builder.maybeSingle = jest.fn(() => Promise.resolve(next()));
  builder.then = (resolve: any, reject: any) => Promise.resolve(next()).then(resolve, reject);
  return builder;
}

function mockTables(overrides: Record<string, ReturnType<typeof chain>>) {
  fromTables = overrides;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (table: string) => fromTables[table] ?? chain({ data: null, error: null }),
  })),
}));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

// ── Test suite ───────────────────────────────────────────────────────────────

describe('PremiumService', () => {
  let service: PremiumService;

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockAppConfig.FEATURE_PREMIUM = true;
    mockAppConfig.FEATURE_WHERE_ARE_THEY_NOW = true;
    mockAppConfig.FEATURE_MEMORY_CAPSULE = false;

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PremiumService,
        {
          provide: AppLogger,
          useValue: { setContext: jest.fn().mockReturnThis(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PremiumService>(PremiumService);
  });

  // ── isPremium() ──────────────────────────────────────────────────────────

  describe('isPremium()', () => {
    it('returns false without querying the DB when FEATURE_PREMIUM is off', async () => {
      mockAppConfig.FEATURE_PREMIUM = false;
      const subscriptionsChain = chain({ data: [], error: null });
      mockTables({ premium_subscriptions: subscriptionsChain });

      const result = await service.isPremium('user-1');

      expect(result).toBe(false);
      expect(subscriptionsChain.select).not.toHaveBeenCalled();
    });

    it('returns false when there is no active subscription', async () => {
      mockTables({ premium_subscriptions: chain({ data: [], error: null }) });

      expect(await service.isPremium('user-1')).toBe(false);
    });

    it('returns true for an active, unexpired subscription', async () => {
      mockTables({
        premium_subscriptions: chain({
          data: [{ status: 'active', plan: 'monthly', started_at: past(10), expires_at: future(20) }],
          error: null,
        }),
      });

      expect(await service.isPremium('user-1')).toBe(true);
    });

    it('returns false for an "active" row that has actually already expired', async () => {
      mockTables({
        premium_subscriptions: chain({
          data: [{ status: 'active', plan: 'monthly', started_at: past(40), expires_at: past(5) }],
          error: null,
        }),
      });

      expect(await service.isPremium('user-1')).toBe(false);
    });

    it('fails closed (returns false) on a database error', async () => {
      mockTables({ premium_subscriptions: chain({ data: null, error: { message: 'db down' } }) });

      expect(await service.isPremium('user-1')).toBe(false);
    });
  });

  // ── assertPremium() ──────────────────────────────────────────────────────

  describe('assertPremium()', () => {
    it('throws ForbiddenException when not premium', async () => {
      mockTables({ premium_subscriptions: chain({ data: [], error: null }) });

      await expect(service.assertPremium('user-1')).rejects.toThrow(ForbiddenException);
    });

    it('resolves when premium', async () => {
      mockTables({
        premium_subscriptions: chain({
          data: [{ status: 'active', plan: 'annual', started_at: past(1), expires_at: future(300) }],
          error: null,
        }),
      });

      await expect(service.assertPremium('user-1')).resolves.not.toThrow();
    });
  });

  // ── Storage tiers ────────────────────────────────────────────────────────

  describe('getStorageLimitMb() / getAttachmentLimitMb()', () => {
    it('returns free-tier limits for a non-premium user', async () => {
      mockTables({ premium_subscriptions: chain({ data: [], error: null }) });

      expect(await service.getStorageLimitMb('user-1')).toBe(mockAppConfig.STORAGE_FREE_MB);
      expect(await service.getAttachmentLimitMb('user-1')).toBe(mockAppConfig.ATTACHMENT_FREE_MAX_MB);
    });

    it('returns premium-tier limits for a premium user', async () => {
      mockTables({
        premium_subscriptions: chain({
          data: [{ status: 'active', plan: 'monthly', started_at: past(1), expires_at: future(30) }],
          error: null,
        }),
      });

      expect(await service.getStorageLimitMb('user-1')).toBe(mockAppConfig.STORAGE_PREMIUM_MB);
      expect(await service.getAttachmentLimitMb('user-1')).toBe(mockAppConfig.ATTACHMENT_PREMIUM_MAX_MB);
    });
  });

  // ── getStatus() ──────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('returns all nulls and isPremium=false when there is no subscription history', async () => {
      mockTables({ premium_subscriptions: chain({ data: [], error: null }) });

      const result = await service.getStatus('user-1');

      expect(result).toEqual({ isPremium: false, plan: null, status: null, startedAt: null, expiresAt: null });
    });

    it('shows a cancelled subscription (not just active ones)', async () => {
      const row = { status: 'cancelled', plan: 'monthly', started_at: past(60), expires_at: past(10) };
      mockTables({
        premium_subscriptions: chain({ data: [row], error: null }, { data: [row], error: null }),
      });

      const result = await service.getStatus('user-1');

      expect(result.status).toBe('cancelled');
      expect(result.isPremium).toBe(false);
    });
  });

  // ── getFeatures() ────────────────────────────────────────────────────────

  describe('getFeatures()', () => {
    it('reflects the relevant appConfig flags per feature', () => {
      mockAppConfig.FEATURE_MEMORY_CAPSULE = false;
      mockAppConfig.FEATURE_WHERE_ARE_THEY_NOW = true;

      const features = service.getFeatures();
      const byKey = Object.fromEntries(features.map((f) => [f.key, f]));

      expect(byKey.memory_capsule.enabled).toBe(false);
      expect(byKey.where_are_they_now.enabled).toBe(true);
      expect(byKey.career_paths.enabled).toBe(true);
      expect(byKey.reunion_planner.enabled).toBe(true);
      expect(byKey.extra_storage.description).toContain(String(mockAppConfig.STORAGE_FREE_MB));
    });
  });

  // ── assertFeatureEnabled() ───────────────────────────────────────────────

  describe('assertFeatureEnabled()', () => {
    it('throws when FEATURE_PREMIUM is off', () => {
      mockAppConfig.FEATURE_PREMIUM = false;
      expect(() => service.assertFeatureEnabled()).toThrow(ForbiddenException);
    });

    it('does not throw when FEATURE_PREMIUM is on', () => {
      mockAppConfig.FEATURE_PREMIUM = true;
      expect(() => service.assertFeatureEnabled()).not.toThrow();
    });
  });
});
