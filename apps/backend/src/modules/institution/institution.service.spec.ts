/**
 * Unit tests for InstitutionService.
 *
 * Covers:
 * - searchInstitutions(): pass-through query + graceful empty array on error
 * - submitClaim(): missing institution, already-claimed, duplicate claim,
 *   successful pending_approval creation (audited + emitted)
 * - approveClaim()/rejectClaim(): not-found/already-decided guards, the
 *   institution-already-claimed race, successful approval (persona active +
 *   primary, institution stamped) and rejection (persona suspended)
 * - listAdmins(): non-admin caller rejected, roster + pending invites returned
 * - inviteAdmin(): non-primary rejected, cap enforcement (personas +
 *   outstanding invites together), successful invite (token verifiable,
 *   audited, emitted)
 * - acceptInvite(): bad/expired token, missing/used/expired invite row,
 *   no matching account, duplicate persona, successful acceptance
 * - removeAdmin(): non-primary rejected, self-removal blocked, target
 *   not found, primary-admin protection, successful suspension
 * - transferPrimaryAdmin(): self-transfer blocked, non-primary rejected,
 *   inactive target rejected, successful atomic-in-practice swap
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { InstitutionService } from './institution.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType, PersonaType } from '@alumini/types';
import { appConfig } from '@alumini/config/app';

// ── Supabase mock (sequenced per table — see identity.service.spec.ts for the same pattern) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'upsert', 'eq', 'is', 'gt', 'in', 'order', 'limit', 'ilike'].forEach(
    (method) => {
      builder[method] = jest.fn(() => builder);
    },
  );
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

// ── Test suite ───────────────────────────────────────────────────────────────

describe('InstitutionService', () => {
  let service: InstitutionService;
  let jwtService: JwtService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockEventEmit = jest.fn();

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';

    mockTables({});
    jest.clearAllMocks();

    jwtService = new JwtService({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstitutionService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        { provide: EventEmitter2, useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() } },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<InstitutionService>(InstitutionService);
  });

  // ── searchInstitutions() ─────────────────────────────────────────────────

  describe('searchInstitutions()', () => {
    it('returns matching institutions', async () => {
      mockTables({ institutions: chain({ data: [{ id: 'inst-1', name: 'MP Birla' }], error: null }) });

      const result = await service.searchInstitutions({ q: 'birla' } as any);
      expect(result).toEqual([{ id: 'inst-1', name: 'MP Birla' }]);
    });

    it('returns an empty array on a Supabase error rather than throwing', async () => {
      mockTables({ institutions: chain({ data: null, error: { message: 'query failed' } }) });

      const result = await service.searchInstitutions({ q: 'birla' } as any);
      expect(result).toEqual([]);
    });
  });

  // ── requestInstitution() / getMyInstitutionRequests() ───────────────────

  describe('requestInstitution()', () => {
    const dto = {
      name: 'New School',
      type: 'school' as const,
      countryCode: 'IN',
      requesterRelationship: 'alumni' as const,
    };

    it('throws ConflictException with existing institution details when a similar name already exists', async () => {
      mockTables({
        institutions: chain({ data: { id: 'inst-1', name: 'New School', slug: 'NEWSCH', type: 'school' }, error: null }),
      });

      await expect(service.requestInstitution('user-1', dto)).rejects.toThrow(ConflictException);
    });

    it('creates a pending request and audits it when no similar institution exists', async () => {
      mockTables({
        institutions: chain({ data: null, error: null }),
        institution_requests: chain({ data: { id: 'req-1' }, error: null }),
      });

      const result = await service.requestInstitution('user-1', dto);

      expect(result).toEqual({ message: 'Request submitted', requestId: 'req-1' });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.INSTITUTION_REQUEST_SUBMITTED }),
      );
    });
  });

  describe('getMyInstitutionRequests()', () => {
    it('returns the caller’s own requests', async () => {
      mockTables({
        institution_requests: chain({ data: [{ id: 'req-1', name: 'New School', status: 'pending' }], error: null }),
      });

      const result = await service.getMyInstitutionRequests('user-1');
      expect(result).toEqual([{ id: 'req-1', name: 'New School', status: 'pending' }]);
    });
  });

  // ── submitClaim() ────────────────────────────────────────────────────────

  describe('submitClaim()', () => {
    it('throws NotFoundException when the institution does not exist', async () => {
      mockTables({ institutions: chain({ data: null, error: null }) });

      await expect(
        service.submitClaim('user-1', 'inst-missing', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the institution is already claimed', async () => {
      mockTables({ institutions: chain({ data: { id: 'inst-1', is_claimed: true }, error: null }) });

      await expect(service.submitClaim('user-1', 'inst-1', {} as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException on a duplicate pending/active claim', async () => {
      mockTables({
        institutions: chain({ data: { id: 'inst-1', is_claimed: false }, error: null }),
        personas: chain({ data: { id: 'existing-claim' }, error: null }),
      });

      await expect(service.submitClaim('user-1', 'inst-1', {} as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates a pending_approval claim and audits + emits it', async () => {
      mockTables({
        institutions: chain({ data: { id: 'inst-1', is_claimed: false }, error: null }),
        personas: chain(
          { data: null, error: null }, // no duplicate
          { data: { id: 'persona-1', status: 'pending_approval' }, error: null }, // insert
        ),
      });

      const result = await service.submitClaim('user-1', 'inst-1', { justification: 'I run this school' } as any);

      expect(result).toEqual(expect.objectContaining({ id: 'persona-1', status: 'pending_approval' }));
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.INSTITUTION_CLAIMED }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith(
        'institution.claim.submitted',
        expect.objectContaining({ institutionId: 'inst-1', userId: 'user-1' }),
      );
    });
  });

  // ── approveClaim() / rejectClaim() ───────────────────────────────────────

  describe('approveClaim()', () => {
    it('throws NotFoundException for a non-existent claim', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(service.approveClaim('ops-1', 'persona-missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the claim was already decided', async () => {
      mockTables({
        personas: chain({
          data: { id: 'persona-1', type: PersonaType.SCHOOL_ADMIN, status: 'active' },
          error: null,
        }),
      });

      await expect(service.approveClaim('ops-1', 'persona-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when another claim already won the race', async () => {
      mockTables({
        personas: chain({
          data: {
            id: 'persona-1',
            type: PersonaType.SCHOOL_ADMIN,
            status: 'pending_approval',
            institution_id: 'inst-1',
            user_id: 'user-1',
          },
          error: null,
        }),
        institutions: chain({ data: { id: 'inst-1', is_claimed: true }, error: null }),
      });

      await expect(service.approveClaim('ops-1', 'persona-1')).rejects.toThrow(ConflictException);
    });

    it('activates the persona as primary admin and stamps the institution', async () => {
      mockTables({
        personas: chain(
          {
            data: {
              id: 'persona-1',
              type: PersonaType.SCHOOL_ADMIN,
              status: 'pending_approval',
              institution_id: 'inst-1',
              user_id: 'user-1',
            },
            error: null,
          },
          { data: null, error: null }, // update
        ),
        institutions: chain(
          { data: { id: 'inst-1', is_claimed: false }, error: null },
          { data: null, error: null }, // update
        ),
      });

      const result = await service.approveClaim('ops-1', 'persona-1');

      expect(result).toEqual({ institutionId: 'inst-1', userId: 'user-1', isPrimaryAdmin: true });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.INSTITUTION_CLAIM_APPROVED }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith(
        'institution.claim.approved',
        expect.objectContaining({ institutionId: 'inst-1', userId: 'user-1' }),
      );
    });
  });

  describe('rejectClaim()', () => {
    it('suspends the persona and audits the rejection reason', async () => {
      mockTables({
        personas: chain(
          {
            data: {
              id: 'persona-1',
              type: PersonaType.SCHOOL_ADMIN,
              status: 'pending_approval',
              institution_id: 'inst-1',
              user_id: 'user-1',
            },
            error: null,
          },
          { data: null, error: null }, // update
        ),
      });

      await service.rejectClaim('ops-1', 'persona-1', { reason: 'Could not verify affiliation' });

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.INSTITUTION_CLAIM_REJECTED,
          metadata: expect.objectContaining({ reason: 'Could not verify affiliation' }),
        }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith(
        'institution.claim.rejected',
        expect.objectContaining({ reason: 'Could not verify affiliation' }),
      );
    });
  });

  // ── listAdmins() ─────────────────────────────────────────────────────────

  describe('listAdmins()', () => {
    it('throws ForbiddenException when the caller is not an active admin', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(service.listAdmins('outsider', 'inst-1')).rejects.toThrow(ForbiddenException);
    });

    it('returns the admin roster and pending invites', async () => {
      mockTables({
        personas: chain(
          { data: { id: 'caller-persona' }, error: null }, // assertActiveAdmin
          { data: [{ id: 'admin-1' }], error: null }, // roster
        ),
        institution_admin_invites: chain({ data: [{ id: 'invite-1' }], error: null }),
      });

      const result = await service.listAdmins('user-1', 'inst-1');

      expect(result.admins).toEqual([{ id: 'admin-1' }]);
      expect(result.pendingInvites).toEqual([{ id: 'invite-1' }]);
    });
  });

  // ── inviteAdmin() ────────────────────────────────────────────────────────

  describe('inviteAdmin()', () => {
    it('throws ForbiddenException when the caller is not the primary admin', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(
        service.inviteAdmin('not-primary', 'inst-1', { email: 'co@example.com' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException once personas + pending invites reach appConfig.INSTITUTION_MAX_ADMINS', async () => {
      mockTables({
        personas: chain(
          { data: { id: 'primary-persona' }, error: null }, // assertPrimaryAdmin
          { data: null, error: null, count: appConfig.INSTITUTION_MAX_ADMINS - 1 }, // persona count
        ),
        institution_admin_invites: chain({ data: null, error: null, count: 1 }), // + 1 pending invite = at cap
      });

      await expect(
        service.inviteAdmin('primary-1', 'inst-1', { email: 'co@example.com' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the invite, signs a verifiable token, audits, and emits a hand-off event', async () => {
      mockTables({
        personas: chain(
          { data: { id: 'primary-persona' }, error: null },
          { data: null, error: null, count: 1 },
        ),
        institution_admin_invites: chain(
          { data: null, error: null, count: 0 },
          { data: { id: 'invite-1', email: 'co@example.com' }, error: null }, // insert
        ),
      });

      const result = await service.inviteAdmin('primary-1', 'inst-1', {
        email: 'co@example.com',
      } as any);

      expect(result).toEqual(
        expect.objectContaining({ inviteId: 'invite-1', email: 'co@example.com' }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.INSTITUTION_ADMIN_INVITED }),
      );

      const [, emittedPayload] = mockEventEmit.mock.calls.find(
        (call) => call[0] === 'institution.admin.invited',
      );
      expect(emittedPayload.token).toBeDefined();

      const decoded: any = await jwtService.verifyAsync(emittedPayload.token, {
        secret: process.env.JWT_SECRET,
      });
      expect(decoded).toEqual(
        expect.objectContaining({ inviteId: 'invite-1', institutionId: 'inst-1', purpose: 'admin_invite' }),
      );
    });
  });

  // ── acceptInvite() ───────────────────────────────────────────────────────

  describe('acceptInvite()', () => {
    async function signInviteToken(overrides: Partial<Record<string, any>> = {}) {
      return jwtService.signAsync(
        {
          inviteId: 'invite-1',
          institutionId: 'inst-1',
          email: 'co@example.com',
          purpose: 'admin_invite',
          ...overrides,
        },
        { secret: process.env.JWT_SECRET, expiresIn: '48h' },
      );
    }

    it('throws UnauthorizedException for a garbage/invalid token', async () => {
      await expect(service.acceptInvite('not-a-real-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException when the invite row is missing', async () => {
      const token = await signInviteToken();
      mockTables({ institution_admin_invites: chain({ data: null, error: null }) });

      await expect(service.acceptInvite(token)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the invite was already accepted', async () => {
      const token = await signInviteToken();
      mockTables({
        institution_admin_invites: chain({
          data: {
            id: 'invite-1',
            institution_id: 'inst-1',
            email: 'co@example.com',
            accepted_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
          error: null,
        }),
      });

      await expect(service.acceptInvite(token)).rejects.toThrow(ConflictException);
    });

    it('throws UnauthorizedException when the invite has expired', async () => {
      const token = await signInviteToken();
      mockTables({
        institution_admin_invites: chain({
          data: {
            id: 'invite-1',
            institution_id: 'inst-1',
            email: 'co@example.com',
            accepted_at: null,
            expires_at: new Date(Date.now() - 1000).toISOString(),
          },
          error: null,
        }),
      });

      await expect(service.acceptInvite(token)).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException when no account exists for the invited email', async () => {
      const token = await signInviteToken();
      mockTables({
        institution_admin_invites: chain({
          data: {
            id: 'invite-1',
            institution_id: 'inst-1',
            email: 'co@example.com',
            accepted_at: null,
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
          error: null,
        }),
        profiles: chain({ data: null, error: null }),
      });

      await expect(service.acceptInvite(token)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the invitee is already an admin there', async () => {
      const token = await signInviteToken();
      mockTables({
        institution_admin_invites: chain({
          data: {
            id: 'invite-1',
            institution_id: 'inst-1',
            email: 'co@example.com',
            accepted_at: null,
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
          error: null,
        }),
        profiles: chain({ data: { id: 'user-2' }, error: null }),
        personas: chain({ data: { id: 'already-admin' }, error: null }),
      });

      await expect(service.acceptInvite(token)).rejects.toThrow(ConflictException);
    });

    it('creates an active co-admin persona and audits acceptance', async () => {
      const token = await signInviteToken();
      mockTables({
        institution_admin_invites: chain(
          {
            data: {
              id: 'invite-1',
              institution_id: 'inst-1',
              email: 'co@example.com',
              accepted_at: null,
              expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            },
            error: null,
          },
          { data: null, error: null }, // mark accepted
        ),
        profiles: chain({ data: { id: 'user-2' }, error: null }),
        personas: chain(
          { data: null, error: null }, // no existing persona
          { data: { id: 'persona-co', status: 'active' }, error: null }, // insert
        ),
      });

      const result = await service.acceptInvite(token);

      expect(result).toEqual(expect.objectContaining({ id: 'persona-co', status: 'active' }));
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.INSTITUTION_ADMIN_ACCEPTED, actorId: 'user-2' }),
      );
    });
  });

  // ── removeAdmin() ────────────────────────────────────────────────────────

  describe('removeAdmin()', () => {
    it('throws ForbiddenException when the actor is not the primary admin', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(
        service.removeAdmin('not-primary', 'inst-1', 'target-1', { reason: 'inactive' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the primary admin tries to remove themselves', async () => {
      mockTables({ personas: chain({ data: { id: 'primary-persona' }, error: null }) });

      await expect(
        service.removeAdmin('primary-1', 'inst-1', 'primary-1', { reason: 'oops' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the target is not an active admin', async () => {
      mockTables({
        personas: chain(
          { data: { id: 'primary-persona' }, error: null },
          { data: null, error: null },
        ),
      });

      await expect(
        service.removeAdmin('primary-1', 'inst-1', 'target-1', { reason: 'inactive' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the target is (unexpectedly) the primary admin', async () => {
      mockTables({
        personas: chain(
          { data: { id: 'primary-persona' }, error: null },
          { data: { id: 'target-persona', status: 'active', is_primary_admin: true }, error: null },
        ),
      });

      await expect(
        service.removeAdmin('primary-1', 'inst-1', 'target-1', { reason: 'inactive' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('suspends the target admin and audits the reason', async () => {
      mockTables({
        personas: chain(
          { data: { id: 'primary-persona' }, error: null },
          { data: { id: 'target-persona', status: 'active', is_primary_admin: false }, error: null },
          { data: null, error: null }, // update
        ),
      });

      await service.removeAdmin('primary-1', 'inst-1', 'target-1', { reason: 'Left the school' } as any);

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.INSTITUTION_ADMIN_REMOVED,
          metadata: expect.objectContaining({ reason: 'Left the school' }),
        }),
      );
    });
  });

  // ── transferPrimaryAdmin() ───────────────────────────────────────────────

  describe('transferPrimaryAdmin()', () => {
    it('throws BadRequestException when transferring to yourself', async () => {
      await expect(
        service.transferPrimaryAdmin('user-1', 'inst-1', { targetUserId: 'user-1' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when the actor is not the primary admin', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(
        service.transferPrimaryAdmin('not-primary', 'inst-1', { targetUserId: 'user-2' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the target is not an active admin', async () => {
      mockTables({
        personas: chain(
          { data: { id: 'primary-persona' }, error: null },
          { data: null, error: null },
        ),
      });

      await expect(
        service.transferPrimaryAdmin('primary-1', 'inst-1', { targetUserId: 'user-2' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('demotes the old primary, promotes the new one, and audits the transfer', async () => {
      mockTables({
        personas: chain(
          { data: { id: 'primary-persona' }, error: null }, // assertPrimaryAdmin
          { data: { id: 'target-persona', status: 'active' }, error: null }, // target lookup
          { data: null, error: null }, // demote
          { data: null, error: null }, // promote
        ),
      });

      await service.transferPrimaryAdmin('primary-1', 'inst-1', { targetUserId: 'user-2' } as any);

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.INSTITUTION_ADMIN_TRANSFERRED,
          metadata: { from_user_id: 'primary-1', to_user_id: 'user-2' },
        }),
      );
    });
  });
});
