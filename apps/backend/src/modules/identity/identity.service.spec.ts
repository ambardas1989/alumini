/**
 * Unit tests for IdentityService.
 *
 * Covers:
 * - getProfile()/updateProfile(): happy path + not-found / empty-patch guards
 * - listPersonas(): returns the caller's own personas
 * - addPersona(): alumni (institutionId rejected), teacher (institution
 *   required, duplicate rejected), school_admin (pending_approval always,
 *   admin cap enforced, event emitted)
 * - switchPersona(): every scenario —
 *     - switching to a persona that doesn't exist / isn't active yet
 *       (this is what makes "school_admin can't self-approve" hold)
 *     - successful switch (audits PERSONA_SWITCHED with from/to)
 *     - idempotent switch to the already-active persona (no audit)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { IdentityService } from './identity.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType, ErrorCode, PersonaType } from '@alumini/types';
import { appConfig } from '@alumini/config/app';

// ── Supabase mock ──────────────────────────────────────────────────────────
//
// Each table gets a queue of { data, error, count? } results, consumed in
// call order for that test. This is necessary here (unlike a single static
// result per table) because several IdentityService methods hit the same
// table more than once per call with genuinely different expected results
// — e.g. addPersona() does a duplicate-check SELECT on `personas` and then
// an INSERT on `personas` in the same call.

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'upsert', 'eq', 'is', 'gt', 'in', 'order', 'limit'].forEach(
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

describe('IdentityService', () => {
  let service: IdentityService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockEventEmit = jest.fn();

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        { provide: EventEmitter2, useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() } },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);
  });

  // ── getProfile() ─────────────────────────────────────────────────────────

  describe('getProfile()', () => {
    it('returns the profile row for the given user', async () => {
      mockTables({
        profiles: chain({ data: { id: 'user-1', email: 'user@example.com' }, error: null }),
      });

      const result = await service.getProfile('user-1');
      expect(result).toEqual({ id: 'user-1', email: 'user@example.com' });
    });

    it('throws NotFoundException when the profile does not exist', async () => {
      mockTables({ profiles: chain({ data: null, error: { message: 'not found' } }) });

      await expect(service.getProfile('missing')).rejects.toThrow(NotFoundException);
    });

    it('carries a recognisable ErrorCode so the frontend shows a profile-specific message, not the generic fallback (BACKEND FIX 4 / FRONTEND FIX 1)', async () => {
      mockTables({ profiles: chain({ data: null, error: { message: 'not found' } }) });

      let caught: NotFoundException | undefined;
      try {
        await service.getProfile('missing');
      } catch (err) {
        caught = err as NotFoundException;
      }

      expect(caught).toBeInstanceOf(NotFoundException);
      expect(caught!.getResponse()).toMatchObject({ error: ErrorCode.PROFILE_NOT_FOUND });
    });
  });

  // ── updateProfile() ──────────────────────────────────────────────────────

  describe('updateProfile()', () => {
    it('rejects an empty patch', async () => {
      await expect(service.updateProfile('user-1', {})).rejects.toThrow(BadRequestException);
    });

    it('updates only the supplied fields', async () => {
      mockTables({
        profiles: chain({ data: { id: 'user-1', full_name: 'New Name' }, error: null }),
      });

      const result = await service.updateProfile('user-1', { fullName: 'New Name' });
      expect(result).toEqual({ id: 'user-1', full_name: 'New Name' });
    });
  });

  // ── listPersonas() ───────────────────────────────────────────────────────

  describe('listPersonas()', () => {
    it("returns the caller's personas", async () => {
      const personas = [{ id: 'p1', type: PersonaType.ALUMNI }];
      mockTables({ personas: chain({ data: personas, error: null }) });

      const result = await service.listPersonas('user-1');
      expect(result).toEqual(personas);
    });
  });

  // ── addPersona() ─────────────────────────────────────────────────────────

  describe('addPersona()', () => {
    it('creates an alumni persona as active, with no institution', async () => {
      mockTables({
        personas: chain({
          data: { id: 'persona-alumni', type: PersonaType.ALUMNI, status: 'active' },
          error: null,
        }),
      });

      const result = await service.addPersona('user-1', { type: PersonaType.ALUMNI } as any);

      expect(result).toEqual(
        expect.objectContaining({ id: 'persona-alumni', status: 'active' }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.PERSONA_ADDED,
          metadata: expect.objectContaining({ type: PersonaType.ALUMNI, status: 'active' }),
        }),
      );
    });

    it('rejects an alumni persona that supplies an institutionId', async () => {
      await expect(
        service.addPersona('user-1', {
          type: PersonaType.ALUMNI,
          institutionId: 'inst-1',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires institutionId for a teacher persona', async () => {
      await expect(
        service.addPersona('user-1', { type: PersonaType.TEACHER } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the institution does not exist', async () => {
      mockTables({ institutions: chain({ data: null, error: null }) });

      await expect(
        service.addPersona('user-1', {
          type: PersonaType.TEACHER,
          institutionId: 'missing-inst',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a duplicate teacher persona at the same institution', async () => {
      mockTables({
        institutions: chain({ data: { id: 'inst-1' }, error: null }),
        personas: chain({ data: { id: 'existing-persona' }, error: null }), // duplicate found
      });

      await expect(
        service.addPersona('user-1', {
          type: PersonaType.TEACHER,
          institutionId: 'inst-1',
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a teacher persona as active immediately', async () => {
      mockTables({
        institutions: chain({ data: { id: 'inst-1' }, error: null }),
        personas: chain(
          { data: null, error: null }, // duplicate check — none found
          { data: { id: 'persona-teacher', type: PersonaType.TEACHER, status: 'active' }, error: null }, // insert
        ),
      });

      const result = await service.addPersona('user-1', {
        type: PersonaType.TEACHER,
        institutionId: 'inst-1',
      } as any);

      expect(result).toEqual(
        expect.objectContaining({ id: 'persona-teacher', status: 'active' }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ type: PersonaType.TEACHER, status: 'active' }),
        }),
      );
    });

    it('creates a school_admin persona as pending_approval and emits a hand-off event', async () => {
      mockTables({
        institutions: chain({ data: { id: 'inst-1' }, error: null }),
        personas: chain(
          { data: null, error: null }, // duplicate check
          { data: null, error: null, count: 1 }, // admin cap check — well under the cap
          {
            data: { id: 'persona-admin', type: PersonaType.SCHOOL_ADMIN, status: 'pending_approval' },
            error: null,
          }, // insert
        ),
      });

      const result = await service.addPersona('user-1', {
        type: PersonaType.SCHOOL_ADMIN,
        institutionId: 'inst-1',
      } as any);

      expect(result).toEqual(
        expect.objectContaining({ id: 'persona-admin', status: 'pending_approval' }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            type: PersonaType.SCHOOL_ADMIN,
            status: 'pending_approval',
          }),
        }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith(
        'identity.persona.pending_approval',
        expect.objectContaining({ personaId: 'persona-admin', institutionId: 'inst-1' }),
      );
    });

    it('rejects a new school_admin persona once the institution is at appConfig.INSTITUTION_MAX_ADMINS', async () => {
      mockTables({
        institutions: chain({ data: { id: 'inst-1' }, error: null }),
        personas: chain(
          { data: null, error: null }, // duplicate check
          { data: null, error: null, count: appConfig.INSTITUTION_MAX_ADMINS }, // at the cap
        ),
      });

      await expect(
        service.addPersona('user-1', {
          type: PersonaType.SCHOOL_ADMIN,
          institutionId: 'inst-1',
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── switchPersona() ──────────────────────────────────────────────────────

  describe('switchPersona()', () => {
    it('throws ForbiddenException when the caller has no active persona of that type', async () => {
      // Covers the "school_admin can't self-approve" guarantee: a
      // pending_approval persona is simply never found here.
      mockTables({
        profiles: chain({ data: { active_persona: PersonaType.ALUMNI }, error: null }),
        personas: chain({ data: null, error: null }),
      });

      await expect(
        service.switchPersona('user-1', { type: PersonaType.SCHOOL_ADMIN } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('switches to an active persona and audits from/to', async () => {
      mockTables({
        profiles: chain(
          { data: { active_persona: PersonaType.ALUMNI }, error: null }, // read current
          { data: null, error: null }, // update
        ),
        personas: chain({ data: { id: 'persona-teacher', status: 'active' }, error: null }),
      });

      const result = await service.switchPersona('user-1', { type: PersonaType.TEACHER } as any);

      expect(result).toEqual({ activePersona: PersonaType.TEACHER });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.PERSONA_SWITCHED,
          actorId: 'user-1',
          metadata: { from: PersonaType.ALUMNI, to: PersonaType.TEACHER },
        }),
      );
    });

    it('is a no-op (and does not audit) when switching to the already-active persona', async () => {
      mockTables({
        profiles: chain({ data: { active_persona: PersonaType.TEACHER }, error: null }),
      });

      const result = await service.switchPersona('user-1', { type: PersonaType.TEACHER } as any);

      expect(result).toEqual({ activePersona: PersonaType.TEACHER });
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the profile does not exist', async () => {
      mockTables({ profiles: chain({ data: null, error: { message: 'not found' } }) });

      await expect(
        service.switchPersona('missing', { type: PersonaType.ALUMNI } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
