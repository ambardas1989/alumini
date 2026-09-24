/**
 * Unit tests for MembershipService.
 *
 * Covers:
 * - canAccessChannel(): non-member and unverified member always false;
 *   per-role, per-channel matrix for verified members (classroom/staff_room/
 *   student_alley)
 * - getMembership()/getVerificationStatus(): happy path + not-a-member guard
 * - getPendingVerifications(): returns the pending list
 * - changeRole(): non-admin actor rejected, unverified admin rejected,
 *   non-member target rejected, same-role no-op (no audit), last-admin
 *   demotion blocked, successful demotion (audited DEMOTED) and promotion
 *   (audited PROMOTED)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType, ChannelType, MemberRole } from '@alumini/types';

// ── Supabase mock (sequenced per table — see identity/institution/classroom specs) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'eq', 'order', 'range'].forEach((method) => {
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

/**
 * Default `classrooms` lookup for resolveClassroomId() — every fixture
 * classroomId here ('class-1', ...) is already what the test means by "the
 * classroom's own id", not a real UUID, so this just echoes back whatever
 * `.eq('global_id', x)` was called with rather than requiring every single
 * test to add its own `classrooms: chain(...)` override. Tests that
 * specifically want an unresolvable global ID still override this via
 * their own mockTables({ classrooms: ... }).
 */
function classroomsEchoTable() {
  let queriedId: string | null = null;
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn((column: string, value: string) => {
      if (column === 'global_id') queriedId = value;
      return builder;
    }),
  };
  builder.maybeSingle = jest.fn(() => Promise.resolve({ data: queriedId ? { id: queriedId } : null, error: null }));
  return builder;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (table: string) => fromTables[table] ?? (table === 'classrooms' ? classroomsEchoTable() : chain({ data: null, error: null })),
  })),
}));

// ── Test suite ───────────────────────────────────────────────────────────────

const mockAppLogger = { setContext: jest.fn().mockReturnThis(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('MembershipService', () => {
  let service: MembershipService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        { provide: AppLogger, useValue: mockAppLogger },
      ],
    }).compile();

    service = module.get<MembershipService>(MembershipService);
  });

  // ── canAccessChannel() ───────────────────────────────────────────────────

  describe('canAccessChannel()', () => {
    it('returns false for a non-member', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      const result = await service.canAccessChannel('outsider', 'class-1', ChannelType.CLASSROOM);
      expect(result).toBe(false);
    });

    it('returns false for an unverified member on any channel', async () => {
      mockTables({
        memberships: chain({ data: { role: MemberRole.STUDENT, verification_status: 'pending' }, error: null }),
      });

      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.CLASSROOM)).toBe(false);
    });

    it('lets a verified student into classroom and student_alley, not staff_room', async () => {
      const membership = { role: MemberRole.STUDENT, verification_status: 'verified' };

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.CLASSROOM)).toBe(true);

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STUDENT_ALLEY)).toBe(true);

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STAFF_ROOM)).toBe(false);
    });

    it('lets a verified teacher into classroom and staff_room, not student_alley', async () => {
      const membership = { role: MemberRole.TEACHER, verification_status: 'verified' };

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STAFF_ROOM)).toBe(true);

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STUDENT_ALLEY)).toBe(false);
    });

    it('lets a verified admin into staff_room but not student_alley', async () => {
      const membership = { role: MemberRole.ADMIN, verification_status: 'verified' };

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STAFF_ROOM)).toBe(true);

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STUDENT_ALLEY)).toBe(false);
    });

    it('lets a pending_auto (early-joiner) student into classroom and student_alley, not staff_room', async () => {
      const membership = { role: MemberRole.STUDENT, verification_status: 'pending_auto' };

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.CLASSROOM)).toBe(true);

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STUDENT_ALLEY)).toBe(true);

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STAFF_ROOM)).toBe(false);
    });

    it('does not let a pending_auto teacher into staff_room — that stays verified-only', async () => {
      const membership = { role: MemberRole.TEACHER, verification_status: 'pending_auto' };

      mockTables({ memberships: chain({ data: membership, error: null }) });
      expect(await service.canAccessChannel('u1', 'class-1', ChannelType.STAFF_ROOM)).toBe(false);
    });
  });

  // ── getMembership() / getVerificationStatus() ────────────────────────────

  describe('getMembership()', () => {
    it('throws NotFoundException when the caller is not a member', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      await expect(service.getMembership('u1', 'class-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the membership row', async () => {
      const row = { id: 'm1', role: 'student', verification_status: 'verified' };
      mockTables({ memberships: chain({ data: row, error: null }) });

      const result = await service.getMembership('u1', 'class-1');
      expect(result).toEqual(row);
    });
  });

  describe('getVerificationStatus()', () => {
    it('projects the verification fields off the membership', async () => {
      mockTables({
        memberships: chain({
          data: {
            id: 'm1',
            verification_status: 'verified',
            verification_method: 'email',
            verified_at: '2024-01-01T00:00:00Z',
          },
          error: null,
        }),
      });

      const result = await service.getVerificationStatus('u1', 'class-1');

      expect(result).toEqual({
        classroomId: 'class-1',
        verificationStatus: 'verified',
        verificationMethod: 'email',
        verifiedAt: '2024-01-01T00:00:00Z',
      });
    });
  });

  // ── getPendingVerifications() ────────────────────────────────────────────

  describe('getPendingVerifications()', () => {
    it('returns classrooms with a pending membership', async () => {
      mockTables({
        memberships: chain({ data: [{ classroom_id: 'class-1' }], error: null }),
      });

      const result = await service.getPendingVerifications('u1');
      expect(result).toEqual([{ classroom_id: 'class-1' }]);
    });
  });

  // ── changeRole() ─────────────────────────────────────────────────────────

  describe('changeRole()', () => {
    it('throws ForbiddenException when the actor is not an admin', async () => {
      mockTables({
        memberships: chain({ data: { role: MemberRole.STUDENT, verification_status: 'verified' }, error: null }),
      });

      await expect(
        service.changeRole('actor-1', 'class-1', { targetUserId: 'u2', role: MemberRole.TEACHER } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the actor is an unverified admin', async () => {
      mockTables({
        memberships: chain({ data: { role: MemberRole.ADMIN, verification_status: 'pending' }, error: null }),
      });

      await expect(
        service.changeRole('actor-1', 'class-1', { targetUserId: 'u2', role: MemberRole.TEACHER } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the target is not a member', async () => {
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.ADMIN, verification_status: 'verified' }, error: null },
          { data: null, error: null },
        ),
      });

      await expect(
        service.changeRole('actor-1', 'class-1', { targetUserId: 'u2', role: MemberRole.TEACHER } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('is a no-op (and does not audit) when the target already holds that role', async () => {
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.ADMIN, verification_status: 'verified' }, error: null },
          { data: { id: 'm2', role: MemberRole.TEACHER }, error: null },
        ),
      });

      const result = await service.changeRole('actor-1', 'class-1', {
        targetUserId: 'u2',
        role: MemberRole.TEACHER,
      } as any);

      expect(result).toEqual({ id: 'm2', role: MemberRole.TEACHER });
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when demoting the only admin', async () => {
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.ADMIN, verification_status: 'verified' }, error: null }, // actor
          { data: { id: 'm2', role: MemberRole.ADMIN }, error: null }, // target
          { data: null, error: null, count: 1 }, // admin count
        ),
      });

      await expect(
        service.changeRole('actor-1', 'class-1', { targetUserId: 'actor-1', role: MemberRole.STUDENT } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('demotes successfully when other admins remain, and audits CLASSROOM_ADMIN_DEMOTED', async () => {
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.ADMIN, verification_status: 'verified' }, error: null },
          { data: { id: 'm2', role: MemberRole.ADMIN }, error: null },
          { data: null, error: null, count: 2 },
          { data: { id: 'm2', role: MemberRole.STUDENT }, error: null }, // update
        ),
      });

      const result = await service.changeRole('actor-1', 'class-1', {
        targetUserId: 'u2',
        role: MemberRole.STUDENT,
      } as any);

      expect(result).toEqual({ id: 'm2', role: MemberRole.STUDENT });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.CLASSROOM_ADMIN_DEMOTED,
          metadata: { classroom_id: 'class-1', from_role: MemberRole.ADMIN, to_role: MemberRole.STUDENT },
        }),
      );
    });

    it('promotes successfully without an admin-count check, and audits CLASSROOM_ADMIN_PROMOTED', async () => {
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.ADMIN, verification_status: 'verified' }, error: null },
          { data: { id: 'm2', role: MemberRole.STUDENT }, error: null },
          { data: { id: 'm2', role: MemberRole.TEACHER }, error: null }, // update
        ),
      });

      const result = await service.changeRole('actor-1', 'class-1', {
        targetUserId: 'u2',
        role: MemberRole.TEACHER,
      } as any);

      expect(result).toEqual({ id: 'm2', role: MemberRole.TEACHER });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.CLASSROOM_ADMIN_PROMOTED }),
      );
    });
  });
});
