/**
 * Unit tests for CodesService.
 *
 * Covers:
 * - generatePersonalCode()/generateBatchCode(): school-admin gate, cross-
 *   institution classroom rejection, batch max_redemptions cap, success
 *   (audited, PII excluded from metadata)
 * - generateUniqueCode() retry-then-fail behaviour (via a code that always
 *   collides)
 * - listCodes(): admin gate, computed status per code (active/redeemed/
 *   exhausted/expired), and lazy-expiry logging exactly once per code
 * - importCsv(): missing-column rejection, successful two-row import
 *   (classroom reuse across rows sharing class/section/batch_year,
 *   notify-only-if-email, audit metadata excludes PII)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { CodesService } from './codes.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '@alumini/types';
import { appConfig } from '@alumini/config/app';

// ── Supabase mock (sequenced per table — see prior modules' specs for the same pattern) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'eq', 'order'].forEach((method) => {
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

describe('CodesService', () => {
  let service: CodesService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockEventEmit = jest.fn();

  const mockInstitution = { id: 'inst-1', country_code: 'IN', city_code: 'KOL', slug: 'MPBIRLA' };
  const mockClassroom = { id: 'class-1', institution_id: 'inst-1' };

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodesService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        { provide: EventEmitter2, useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() } },
      ],
    }).compile();

    service = module.get<CodesService>(CodesService);
  });

  // ── generatePersonalCode() ───────────────────────────────────────────────

  describe('generatePersonalCode()', () => {
    const dto = { institutionId: 'inst-1', classroomId: 'class-1', boundName: 'Arjun Kapoor', boundEmail: 'arjun@example.com' };

    it('throws ForbiddenException for a non-school-admin', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(service.generatePersonalCode('user-1', dto as any)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the classroom does not exist', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: null, error: null }),
      });

      await expect(service.generatePersonalCode('admin-1', dto as any)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the classroom belongs to a different institution', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: { id: 'class-1', institution_id: 'other-inst' }, error: null }),
      });

      await expect(service.generatePersonalCode('admin-1', dto as any)).rejects.toThrow(BadRequestException);
    });

    it('generates the code, audits without PII, and returns the code row', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: mockClassroom, error: null }),
        institutions: chain({ data: mockInstitution, error: null }),
        institution_codes: chain(
          { data: null, error: null }, // uniqueness check — no collision
          { data: { id: 'code-1', code: 'IN-2026-A7K2PQ', type: 'personal' }, error: null }, // insert
        ),
      });

      const result = await service.generatePersonalCode('admin-1', dto as any);

      expect(result.code).toBe('IN-2026-A7K2PQ');
      const auditCall = mockAuditLog.mock.calls.find((c) => c[0].eventType === AuditEventType.CODE_GENERATED)[0];
      expect(auditCall.metadata).toEqual({
        classroom_id: 'class-1',
        institution_id: 'inst-1',
        code_type: 'personal',
      });
    });

    it('throws BadRequestException after exhausting uniqueness retries', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: mockClassroom, error: null }),
        institutions: chain({ data: mockInstitution, error: null }),
        // Every uniqueness check finds a collision, forever
        institution_codes: chain({ data: { id: 'existing-code' }, error: null }),
      });

      await expect(service.generatePersonalCode('admin-1', dto as any)).rejects.toThrow(BadRequestException);
    });
  });

  // ── generateBatchCode() ──────────────────────────────────────────────────

  describe('generateBatchCode()', () => {
    it('throws BadRequestException when max_redemptions exceeds the configured cap', async () => {
      mockTables({ personas: chain({ data: { id: 'p1' }, error: null }) });

      await expect(
        service.generateBatchCode('admin-1', {
          institutionId: 'inst-1',
          classroomId: 'class-1',
          maxRedemptions: appConfig.MAX_BATCH_CODE_REDEMPTIONS + 1,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('generates a batch code with max_redemptions in the audit metadata', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: mockClassroom, error: null }),
        institutions: chain({ data: mockInstitution, error: null }),
        institution_codes: chain(
          { data: null, error: null },
          { data: { id: 'code-2', code: 'IN-2026-B7K2PQ', type: 'batch' }, error: null },
        ),
      });

      const result = await service.generateBatchCode('admin-1', {
        institutionId: 'inst-1',
        classroomId: 'class-1',
        maxRedemptions: 30,
      } as any);

      expect(result.code).toBe('IN-2026-B7K2PQ');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ code_type: 'batch', max_redemptions: 30 }),
        }),
      );
    });
  });

  // ── listCodes() ──────────────────────────────────────────────────────────

  describe('listCodes()', () => {
    it('throws ForbiddenException for a non-school-admin', async () => {
      mockTables({
        classrooms: chain({ data: mockClassroom, error: null }),
        personas: chain({ data: null, error: null }),
      });

      await expect(service.listCodes('user-1', 'class-1')).rejects.toThrow(ForbiddenException);
    });

    it('computes active/redeemed/exhausted/expired status and lazy-logs a newly-expired code exactly once', async () => {
      const codes = [
        {
          id: 'c-active', code: 'IN-2026-A', type: 'personal', bound_name: 'A', bound_email: 'a@x.com',
          max_redemptions: null, redemption_count: 0, is_redeemed: false, redeemed_at: null,
          expires_at: future(30), expiry_logged_at: null, created_at: '2024-01-01',
        },
        {
          id: 'c-redeemed', code: 'IN-2026-B', type: 'personal', bound_name: 'B', bound_email: 'b@x.com',
          max_redemptions: null, redemption_count: 0, is_redeemed: true, redeemed_at: '2024-01-02',
          expires_at: future(30), expiry_logged_at: null, created_at: '2024-01-01',
        },
        {
          id: 'c-exhausted', code: 'IN-2026-C', type: 'batch', bound_name: null, bound_email: null,
          max_redemptions: 5, redemption_count: 5, is_redeemed: false, redeemed_at: null,
          expires_at: future(30), expiry_logged_at: null, created_at: '2024-01-01',
        },
        {
          id: 'c-expired-new', code: 'IN-2026-D', type: 'personal', bound_name: 'D', bound_email: 'd@x.com',
          max_redemptions: null, redemption_count: 0, is_redeemed: false, redeemed_at: null,
          expires_at: past(1), expiry_logged_at: null, created_at: '2024-01-01',
        },
        {
          id: 'c-expired-logged', code: 'IN-2026-E', type: 'personal', bound_name: 'E', bound_email: 'e@x.com',
          max_redemptions: null, redemption_count: 0, is_redeemed: false, redeemed_at: null,
          expires_at: past(1), expiry_logged_at: '2024-06-01T00:00:00Z', created_at: '2024-01-01',
        },
      ];

      mockTables({
        classrooms: chain({ data: mockClassroom, error: null }),
        personas: chain({ data: { id: 'p1' }, error: null }),
        institution_codes: chain(
          { data: codes, error: null }, // initial select
          { data: null, error: null },  // the ONE update for c-expired-new
        ),
      });

      const result = await service.listCodes('admin-1', 'class-1');
      const byId = Object.fromEntries(result.map((r) => [r.id, r.status]));

      expect(byId['c-active']).toBe('active');
      expect(byId['c-redeemed']).toBe('redeemed');
      expect(byId['c-exhausted']).toBe('exhausted');
      expect(byId['c-expired-new']).toBe('expired');
      expect(byId['c-expired-logged']).toBe('expired');

      const expiryAudits = mockAuditLog.mock.calls.filter((c) => c[0].eventType === AuditEventType.CODE_EXPIRED);
      expect(expiryAudits).toHaveLength(1);
      expect(expiryAudits[0][0].targetId).toBe('c-expired-new');
    });
  });

  // ── importCsv() ──────────────────────────────────────────────────────────

  describe('importCsv()', () => {
    it('throws BadRequestException when a required column is missing', async () => {
      mockTables({ personas: chain({ data: { id: 'p1' }, error: null }) });

      const csvContent = 'first_name,last_name,class,section,batch_year,roll_number\nArjun,Kapoor,9,A,2026,42\n';

      await expect(
        service.importCsv('admin-1', { institutionId: 'inst-1', csvContent } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('imports two rows sharing a classroom, notifies only the row with an email, and keeps audit metadata PII-free', async () => {
      const csvContent =
        'first_name,last_name,email,class,section,batch_year,roll_number\n' +
        'Arjun,Kapoor,arjun@example.com,9,A,2026,42\n' +
        'Priya,Sharma,,9,A,2026,43\n';

      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        institutions: chain({ data: mockInstitution, error: null }),
        classrooms: chain({ data: { id: 'class-1' }, error: null }), // classroom already exists — reused for both rows
        institution_codes: chain(
          { data: null, error: null }, // row 1 uniqueness check
          { data: { id: 'code-1', code: 'IN-2026-AAAAAA' }, error: null }, // row 1 insert
          { data: null, error: null }, // row 2 uniqueness check
          { data: { id: 'code-2', code: 'IN-2026-BBBBBB' }, error: null }, // row 2 insert
        ),
      });

      const result = await service.importCsv('admin-1', { institutionId: 'inst-1', csvContent } as any);

      expect(result).toEqual({ rowCount: 2, generatedCount: 2, classroomIds: ['class-1'] });
      expect(mockEventEmit).toHaveBeenCalledTimes(1);
      // The emitted `code` is generateUniqueCode()'s real (genuinely
      // random) return value, not the mocked insert row's fixture code —
      // only its format is predictable here, not the exact string.
      expect(mockEventEmit).toHaveBeenCalledWith(
        'codes.import.notify',
        expect.objectContaining({ email: 'arjun@example.com', code: expect.stringMatching(/^IN-2026-/) }),
      );

      const bulkImportCall = mockAuditLog.mock.calls.find((c) => c[0].eventType === AuditEventType.ADMIN_BULK_IMPORT)[0];
      expect(bulkImportCall.metadata).toEqual({
        row_count: 2,
        generated_count: 2,
        classroom_ids: ['class-1'],
      });
    });

    it('creates a new classroom when none exists yet for the (class, section, batch_year)', async () => {
      const csvContent =
        'first_name,last_name,email,class,section,batch_year,roll_number\n' +
        'Arjun,Kapoor,arjun@example.com,10,B,2027,7\n';

      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        institutions: chain({ data: mockInstitution, error: null }),
        classrooms: chain(
          { data: null, error: null }, // no existing classroom
          { data: { id: 'new-class-1' }, error: null }, // created
        ),
        institution_codes: chain(
          { data: null, error: null },
          { data: { id: 'code-1', code: 'IN-2027-CCCCCC' }, error: null },
        ),
      });

      const result = await service.importCsv('admin-1', { institutionId: 'inst-1', csvContent } as any);

      expect(result.classroomIds).toEqual(['new-class-1']);
    });
  });
});
