/**
 * Unit tests for ClassroomService.
 *
 * Tests:
 * - Classroom ID generation (school and university formats)
 * - Missing grade/program rejected before ID generation
 * - Duplicate detection throws ConflictException
 * - Successful creation auto-adds creator as admin
 * - Institution not found throws BadRequestException
 * - getById()/getByGlobalId()/getByIdOrGlobalId() dispatch
 * - Filing cabinet groups by institution and sorts correctly
 * - Member list redaction: non-member blocked, unverified member sees
 *   redacted names, verified member sees real names/avatars
 * - Join: role defaults to student, teacher persona upgrades to teacher,
 *   duplicate join rejected
 * - Leave: sole admin blocked, non-admin/admin-with-others succeed
 * - Admin settings update: non-admin/unverified-admin rejected, empty
 *   patch rejected, successful update audited
 *
 * MOCK HARNESS: each Supabase table gets its own queue of { data, error,
 * count? } results, consumed in call order — necessary because several
 * methods here hit more than one table, and some hit the same table twice
 * with genuinely different expected results (e.g. joinClassroom()'s
 * duplicate-check SELECT then its INSERT, both on `memberships`). See
 * identity.service.spec.ts / institution.service.spec.ts for the same pattern.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClassroomService } from './classroom.service';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType } from '@alumini/types';
import { redactName } from '@alumini/utils';

// ── Supabase mock ──────────────────────────────────────────────────────────

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'delete', 'eq', 'is', 'gt', 'in', 'order', 'range', 'limit', 'ilike'].forEach(
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

// ── Test Suite ────────────────────────────────────────────────────────────────

const mockAppLogger = { setContext: jest.fn().mockReturnThis(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('ClassroomService', () => {
  let service: ClassroomService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockEventEmit = jest.fn();

  const mockInstitution = {
    id: 'inst-001',
    country_code: 'IN',
    city_code: 'KOL',
    slug: 'MPBIRLA',
    type: 'school',
  };

  // Matches CLASSROOM_SELECT_COLUMNS' aliased shape — createClassroom(),
  // getByGlobalId(), and getById() all now request columns aliased to
  // this camelCase shape (see the BUG FIX comment on the service's
  // CLASSROOM_SELECT_COLUMNS constant), so this simulates what a real
  // aliased PostgREST response looks like, not the raw table row.
  const mockClassroom = {
    id: 'class-001',
    globalId: 'IN-KOL-MPBIRLA-9A-2012',
    institutionId: 'inst-001',
    name: 'MP Birla Class 9A 2012',
    batchYear: 2012,
    grade: '9',
    section: 'A',
    memberCount: 0,
  };

  // The institution row as joined into getByGlobalId()/getById() — also
  // aliased (INSTITUTION_JOIN_COLUMNS). Distinct from mockInstitution
  // above, which simulates createClassroom()'s own separate, unaliased
  // institution lookup (it only ever reads institution.country_code/
  // city_code directly, not through the join).
  const mockJoinedInstitution = {
    id: 'inst-001',
    name: 'MP Birla',
    slug: 'MPBIRLA',
    type: 'school',
    cityCode: 'KOL',
    countryCode: 'IN',
  };

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassroomService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        // Must use the string token NestJS registers EventEmitter2 under
        { provide: EventEmitter2, useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() } },
        { provide: AppLogger, useValue: mockAppLogger },
      ],
    }).compile();

    service = module.get<ClassroomService>(ClassroomService);
  });

  // ── createClassroom ──────────────────────────────────────────────────────

  describe('createClassroom()', () => {
    const validDto = {
      institutionId:       'inst-001',
      name:                'MP Birla Class 9A 2012',
      batchYear:           2012,
      grade:               '9',
      section:             'A',
      hasStaffRoom:        true,
      hasStudentAlley:     true,
      requireVerification: true,
    };

    it('should create a classroom with the correct global ID (school format)', async () => {
      mockTables({
        institutions: chain({ data: mockInstitution, error: null }),
        classrooms: chain(
          { data: null, error: null }, // no duplicate
          { data: mockClassroom, error: null }, // insert
        ),
        memberships: chain({ data: null, error: null }), // creator membership insert
      });

      const result = await service.createClassroom('user-123', validDto as any);

      expect(result.globalId).toBe('IN-KOL-MPBIRLA-9A-2012');
    });

    it('should throw BadRequestException when neither grade nor program is provided', async () => {
      mockTables({ institutions: chain({ data: mockInstitution, error: null }) });

      const { grade, ...dtoWithoutGrade } = validDto;

      await expect(
        service.createClassroom('user-123', dtoWithoutGrade as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when classroom already exists', async () => {
      mockTables({
        institutions: chain({ data: mockInstitution, error: null }),
        classrooms: chain({
          data: { id: 'existing-001', global_id: 'IN-KOL-MPBIRLA-9A-2012', member_count: 20 },
          error: null,
        }),
      });

      await expect(
        service.createClassroom('user-123', validDto as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException when institution not found', async () => {
      mockTables({ institutions: chain({ data: null, error: { message: 'Not found' } }) });

      await expect(
        service.createClassroom('user-123', validDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should emit classroom.created event after successful creation', async () => {
      mockTables({
        institutions: chain({ data: mockInstitution, error: null }),
        classrooms: chain({ data: null, error: null }, { data: mockClassroom, error: null }),
        memberships: chain({ data: null, error: null }),
      });

      await service.createClassroom('user-123', validDto as any);

      expect(mockEventEmit).toHaveBeenCalledWith(
        'classroom.created',
        expect.objectContaining({ classroomId: mockClassroom.id, creatorId: 'user-123' }),
      );
    });

    it('should write an audit log on successful creation', async () => {
      mockTables({
        institutions: chain({ data: mockInstitution, error: null }),
        classrooms: chain({ data: null, error: null }, { data: mockClassroom, error: null }),
        memberships: chain({ data: null, error: null }),
      });

      await service.createClassroom('user-123', validDto as any);

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType:  AuditEventType.CLASSROOM_CREATED,
          actorId:    'user-123',
          targetId:   mockClassroom.id,
          targetType: 'classroom',
        }),
      );
    });

    it('should generate correct ID for university (no city code, uses program)', async () => {
      const uniInstitution = {
        id: 'inst-002',
        country_code: 'US',
        city_code: null,
        slug: 'UCDAVIS',
        type: 'university',
      };

      const uniClassroom = { ...mockClassroom, id: 'class-002', globalId: 'US-UCDAVIS-MBA-2025' };

      const uniDto = {
        institutionId:   'inst-002',
        name:            'UC Davis MBA 2025',
        batchYear:       2025,
        program:         'MBA',
        hasStaffRoom:    true,
        hasStudentAlley: true,
        requireVerification: true,
      };

      mockTables({
        institutions: chain({ data: uniInstitution, error: null }),
        classrooms: chain({ data: null, error: null }, { data: uniClassroom, error: null }),
        memberships: chain({ data: null, error: null }),
      });

      const result = await service.createClassroom('user-123', uniDto as any);
      expect(result.globalId).toBe('US-UCDAVIS-MBA-2025');
    });
  });

  // ── getByGlobalId / getById / getByIdOrGlobalId ─────────────────────────

  describe('getByGlobalId()', () => {
    it('should return classroom with institution details', async () => {
      mockTables({
        classrooms: chain({ data: { ...mockClassroom, institution: mockJoinedInstitution }, error: null }),
      });

      const result = await service.getByGlobalId('IN-KOL-MPBIRLA-9A-2012');
      expect(result.globalId).toBe('IN-KOL-MPBIRLA-9A-2012');
      expect(result.institution).toBeDefined();
      expect((result.institution as any).cityCode).toBe('KOL');
    });

    it('should throw NotFoundException when classroom does not exist', async () => {
      mockTables({ classrooms: chain({ data: null, error: { message: 'Not found' } }) });

      await expect(service.getByGlobalId('XX-NOTREAL-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getById()', () => {
    it('should return classroom with institution details', async () => {
      mockTables({
        classrooms: chain({ data: { ...mockClassroom, institution: mockJoinedInstitution }, error: null }),
      });

      const result = await service.getById('class-001');
      expect(result.id).toBe('class-001');
    });

    it('should throw NotFoundException when classroom does not exist', async () => {
      mockTables({ classrooms: chain({ data: null, error: { message: 'Not found' } }) });

      await expect(service.getById('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getByIdOrGlobalId()', () => {
    it('dispatches to getById() for a UUID-shaped parameter', async () => {
      const spy = jest.spyOn(service, 'getById').mockResolvedValue({ id: 'uuid' } as any);
      const globalIdSpy = jest.spyOn(service, 'getByGlobalId');

      await service.getByIdOrGlobalId('550e8400-e29b-41d4-a716-446655440000');

      expect(spy).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
      expect(globalIdSpy).not.toHaveBeenCalled();
    });

    it('dispatches to getByGlobalId() for a non-UUID parameter', async () => {
      const spy = jest.spyOn(service, 'getByGlobalId').mockResolvedValue({ id: 'by-global' } as any);
      const byIdSpy = jest.spyOn(service, 'getById');

      await service.getByIdOrGlobalId('IN-KOL-MPBIRLA-9A-2012');

      expect(spy).toHaveBeenCalledWith('IN-KOL-MPBIRLA-9A-2012');
      expect(byIdSpy).not.toHaveBeenCalled();
    });
  });

  // ── getClassroomsByInstitution (filing cabinet) ─────────────────────────

  describe('getClassroomsByInstitution()', () => {
    it('returns an empty array when the user has no memberships', async () => {
      mockTables({ memberships: chain({ data: [], error: null }) });

      const result = await service.getClassroomsByInstitution('user-1');
      expect(result).toEqual([]);
    });

    it('groups classrooms by institution and sorts active-first then by year descending', async () => {
      const currentYear = new Date().getFullYear();

      mockTables({
        memberships: chain({
          data: [
            {
              role: 'student',
              verification_status: 'verified',
              classroom: { id: 'c1', batchYear: currentYear - 5, institution: { id: 'inst-1', name: 'A' } },
            },
            {
              role: 'student',
              verification_status: 'verified',
              classroom: { id: 'c2', batchYear: currentYear, institution: { id: 'inst-1', name: 'A' } },
            },
            {
              role: 'teacher',
              verification_status: 'verified',
              classroom: { id: 'c3', batchYear: currentYear - 2, institution: { id: 'inst-1', name: 'A' } },
            },
          ],
          error: null,
        }),
      });

      const result: any = await service.getClassroomsByInstitution('user-1');

      expect(result).toHaveLength(1);
      // Active (c2, this year) first, then inactive ones by year descending (c3 before c1)
      expect(result[0].classes.map((c: any) => c.id)).toEqual(['c2', 'c3', 'c1']);
      expect(result[0].classes[0].isActive).toBe(true);
      expect(result[0].classes[1].isActive).toBe(false);
    });

    it('surfaces globalId and memberCount in camelCase — TASK 07 regression: these silently read as undefined before CLASSROOM_SELECT_COLUMNS aliasing was applied here', async () => {
      mockTables({
        memberships: chain({
          data: [
            {
              role: 'student',
              verification_status: 'verified',
              classroom: {
                id: 'c1',
                globalId: 'IN-KOL-MPBIRLA-9A-2012',
                batchYear: new Date().getFullYear(),
                memberCount: 12,
                institution: { id: 'inst-1', name: 'A' },
              },
            },
          ],
          error: null,
        }),
      });

      const result: any = await service.getClassroomsByInstitution('user-1');
      expect(result[0].classes[0].globalId).toBe('IN-KOL-MPBIRLA-9A-2012');
      expect(result[0].classes[0].memberCount).toBe(12);
    });
  });

  // ── getMembers (server-side redaction) ──────────────────────────────────

  describe('getMembers()', () => {
    it('throws ForbiddenException for a non-member', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      await expect(service.getMembers('class-001', 'outsider')).rejects.toThrow(ForbiddenException);
    });

    it('redacts names and hides avatars for an unverified member', async () => {
      mockTables({
        memberships: chain(
          { data: { verification_status: 'pending' }, error: null }, // requester check
          {
            data: [
              {
                user_id: 'u1',
                role: 'student',
                verification_status: 'verified',
                joined_at: '2024-01-01T00:00:00Z',
                profile: { id: 'u1', full_name: 'Priya Sharma', avatar_url: 'https://x/y.png' },
              },
            ],
            error: null,
          },
        ),
      });

      const result = await service.getMembers('class-001', 'unverified-user');

      expect(result[0].fullName).toBe(redactName('Priya Sharma'));
      expect(result[0].fullName).not.toContain('Priya');
      expect(result[0].avatarUrl).toBeNull();
    });

    it('returns real names and avatars for a verified member', async () => {
      mockTables({
        memberships: chain(
          { data: { verification_status: 'verified' }, error: null },
          {
            data: [
              {
                user_id: 'u1',
                role: 'student',
                verification_status: 'verified',
                joined_at: '2024-01-01T00:00:00Z',
                profile: { id: 'u1', full_name: 'Priya Sharma', avatar_url: 'https://x/y.png' },
              },
            ],
            error: null,
          },
        ),
      });

      const result = await service.getMembers('class-001', 'verified-user');

      expect(result[0].fullName).toBe('Priya Sharma');
      expect(result[0].avatarUrl).toBe('https://x/y.png');
    });
  });

  // ── joinClassroom ────────────────────────────────────────────────────────

  describe('joinClassroom()', () => {
    it('throws NotFoundException when the classroom does not exist', async () => {
      mockTables({ classrooms: chain({ data: null, error: null }) });

      await expect(service.joinClassroom('user-1', 'missing-class')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when already a member', async () => {
      mockTables({
        classrooms: chain({ data: { id: 'class-001', institution_id: 'inst-001' }, error: null }),
        memberships: chain({ data: { id: 'existing-membership' }, error: null }),
      });

      await expect(service.joinClassroom('user-1', 'class-001')).rejects.toThrow(ConflictException);
    });

    it('joins as student when the user has no teacher persona at this institution', async () => {
      mockTables({
        classrooms: chain({ data: { id: 'class-001', institution_id: 'inst-001', member_count: 10 }, error: null }),
        memberships: chain(
          { data: null, error: null }, // no duplicate
          { data: { id: 'membership-1', role: 'student' }, error: null }, // insert
        ),
        personas: chain({ data: null, error: null }), // no teacher persona
      });

      const result = await service.joinClassroom('user-1', 'class-001');

      expect(result.role).toBe('student');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.CLASSROOM_JOINED,
          metadata: { role: 'student' },
        }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith(
        'classroom.joined',
        expect.objectContaining({ classroomId: 'class-001', userId: 'user-1', role: 'student' }),
      );
    });

    it('joins as teacher when the user has an active teacher persona at this institution', async () => {
      mockTables({
        classrooms: chain({ data: { id: 'class-001', institution_id: 'inst-001', member_count: 10 }, error: null }),
        memberships: chain(
          { data: null, error: null },
          { data: { id: 'membership-1', role: 'teacher' }, error: null },
        ),
        personas: chain({ data: { id: 'teacher-persona' }, error: null }),
      });

      const result = await service.joinClassroom('user-1', 'class-001');

      expect(result.role).toBe('teacher');
    });

    it('marks an early joiner (member_count <= 3) as pending_auto with verification_method early_member', async () => {
      const membershipsChain = chain(
        { data: null, error: null },
        { data: { id: 'membership-1', role: 'student' }, error: null },
      );
      mockTables({
        classrooms: chain({ data: { id: 'class-001', institution_id: 'inst-001', member_count: 3 }, error: null }),
        memberships: membershipsChain,
        personas: chain({ data: null, error: null }),
      });

      await service.joinClassroom('user-1', 'class-001');

      expect(membershipsChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ verification_status: 'pending_auto', verification_method: 'early_member' }),
      );
    });

    it('marks a later joiner (member_count > 3) as plain pending', async () => {
      const membershipsChain = chain(
        { data: null, error: null },
        { data: { id: 'membership-1', role: 'student' }, error: null },
      );
      mockTables({
        classrooms: chain({ data: { id: 'class-001', institution_id: 'inst-001', member_count: 4 }, error: null }),
        memberships: membershipsChain,
        personas: chain({ data: null, error: null }),
      });

      await service.joinClassroom('user-1', 'class-001');

      expect(membershipsChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ verification_status: 'pending', verification_method: null }),
      );
    });
  });

  // ── leaveClassroom ───────────────────────────────────────────────────────

  describe('leaveClassroom()', () => {
    it('throws NotFoundException when not a member', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      await expect(service.leaveClassroom('user-1', 'class-001')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the caller is the only admin', async () => {
      mockTables({
        memberships: chain(
          { data: { id: 'membership-1', role: 'admin' }, error: null },
          { data: null, error: null, count: 1 }, // admin count check
        ),
      });

      await expect(service.leaveClassroom('user-1', 'class-001')).rejects.toThrow(BadRequestException);
    });

    it('allows a non-admin member to leave', async () => {
      mockTables({
        memberships: chain(
          { data: { id: 'membership-1', role: 'student' }, error: null },
          { data: null, error: null }, // delete
        ),
      });

      await service.leaveClassroom('user-1', 'class-001');

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.CLASSROOM_LEFT }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith(
        'classroom.left',
        expect.objectContaining({ classroomId: 'class-001', userId: 'user-1' }),
      );
    });

    it('allows an admin to leave when other admins remain', async () => {
      mockTables({
        memberships: chain(
          { data: { id: 'membership-1', role: 'admin' }, error: null },
          { data: null, error: null, count: 2 }, // admin count check — 2 admins total
          { data: null, error: null }, // delete
        ),
      });

      await expect(service.leaveClassroom('user-1', 'class-001')).resolves.not.toThrow();
    });
  });

  // ── updateClassroom ──────────────────────────────────────────────────────

  describe('updateClassroom()', () => {
    it('throws ForbiddenException when the caller is not an admin', async () => {
      mockTables({
        memberships: chain({ data: { role: 'student', verification_status: 'verified' }, error: null }),
      });

      await expect(
        service.updateClassroom('class-001', 'user-1', { name: 'New Name' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the admin is unverified', async () => {
      mockTables({
        memberships: chain({ data: { role: 'admin', verification_status: 'pending' }, error: null }),
      });

      await expect(
        service.updateClassroom('class-001', 'user-1', { name: 'New Name' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when no updatable fields are provided', async () => {
      mockTables({
        memberships: chain({ data: { role: 'admin', verification_status: 'verified' }, error: null }),
      });

      await expect(service.updateClassroom('class-001', 'user-1', {} as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updates settings and audits the change for a verified admin', async () => {
      mockTables({
        memberships: chain({ data: { role: 'admin', verification_status: 'verified' }, error: null }),
        classrooms: chain({ data: { ...mockClassroom, name: 'Renamed' }, error: null }),
      });

      const result = await service.updateClassroom('class-001', 'user-1', { name: 'Renamed' } as any);

      expect(result.name).toBe('Renamed');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.CLASSROOM_SETTINGS_UPDATED,
          actorId: 'user-1',
          targetId: 'class-001',
        }),
      );
    });
  });
});
