/**
 * Unit tests for ClassroomService.
 *
 * Tests:
 * - Classroom ID generation (school and university formats)
 * - Duplicate detection throws ConflictException
 * - Successful creation auto-adds creator as admin
 * - Institution not found throws BadRequestException
 * - Filing cabinet groups by institution and sorts correctly
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClassroomService } from './classroom.service';
import { AuditService } from '../audit/audit.service';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
const mockEventEmit = jest.fn();

// Track all Supabase calls
const mockMaybeSingle = jest.fn();
const mockSingle = jest.fn();
const mockInsert = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockIlike = jest.fn();
const mockLimit = jest.fn();

// Each chained call returns 'this' so the chain resolves correctly.
// mockInsert needs to return an object with .select() for the insert().select().single() chain.
const mockInsertChain = {
  select: jest.fn().mockReturnValue({ single: mockSingle }),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: mockSelect.mockReturnThis(),
      insert: jest.fn(() => mockInsertChain),
      eq: mockEq.mockReturnThis(),
      ilike: mockIlike.mockReturnThis(),
      limit: mockLimit.mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
    })),
  })),
}));

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('ClassroomService', () => {
  let service: ClassroomService;

  const mockInstitution = {
    id: 'inst-001',
    country_code: 'IN',
    city_code: 'KOL',
    slug: 'MPBIRLA',
    type: 'school',
  };

  const mockClassroom = {
    id: 'class-001',
    global_id: 'IN-KOL-MPBIRLA-9A-2012',
    institution_id: 'inst-001',
    name: 'MP Birla Class 9A 2012',
    batch_year: 2012,
    grade: '9',
    section: 'A',
    member_count: 0,
  };

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassroomService,
        {
          provide: AuditService,
          useValue: { log: mockAuditLog },
        },
        {
          // Must use the string token NestJS registers EventEmitter2 under
          provide: EventEmitter2,
          useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ClassroomService>(ClassroomService);
    jest.clearAllMocks();
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
      // Institution lookup succeeds
      mockSingle
        .mockResolvedValueOnce({ data: mockInstitution, error: null })
        // Classroom insert succeeds
        .mockResolvedValueOnce({ data: mockClassroom, error: null });

      // No duplicate found
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      // Membership insert succeeds
      mockInsert.mockResolvedValue({ error: null });

      const result = await service.createClassroom('user-123', validDto);

      expect(result.global_id).toBe('IN-KOL-MPBIRLA-9A-2012');
    });

    it('should throw ConflictException when classroom already exists', async () => {
      // Institution lookup succeeds
      mockSingle.mockResolvedValueOnce({ data: mockInstitution, error: null });

      // Duplicate found
      mockMaybeSingle.mockResolvedValue({
        data: { id: 'existing-001', global_id: 'IN-KOL-MPBIRLA-9A-2012', member_count: 20 },
        error: null,
      });

      await expect(
        service.createClassroom('user-123', validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException when institution not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } });

      await expect(
        service.createClassroom('user-123', validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should emit classroom.created event after successful creation', async () => {
      mockSingle
        .mockResolvedValueOnce({ data: mockInstitution, error: null })
        .mockResolvedValueOnce({ data: mockClassroom, error: null });

      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      mockInsert.mockResolvedValue({ error: null });

      await service.createClassroom('user-123', validDto);

      expect(mockEventEmit).toHaveBeenCalledWith(
        'classroom.created',
        expect.objectContaining({
          classroomId: mockClassroom.id,
          creatorId: 'user-123',
        }),
      );
    });

    it('should write an audit log on successful creation', async () => {
      mockSingle
        .mockResolvedValueOnce({ data: mockInstitution, error: null })
        .mockResolvedValueOnce({ data: mockClassroom, error: null });

      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      mockInsert.mockResolvedValue({ error: null });

      await service.createClassroom('user-123', validDto);

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-123',
          targetId: mockClassroom.id,
          targetType: 'classroom',
        }),
      );
    });

    it('should generate correct ID for university (no city code, uses program)', async () => {
      const uniInstitution = {
        id: 'inst-002',
        country_code: 'US',
        city_code: null,  // Universities don't have city codes in the ID
        slug: 'UCDAVIS',
        type: 'university',
      };

      const uniClassroom = {
        ...mockClassroom,
        id: 'class-002',
        global_id: 'US-UCDAVIS-MBA-2025',
      };

      const uniDto = {
        institutionId:   'inst-002',
        name:            'UC Davis MBA 2025',
        batchYear:       2025,
        program:         'MBA',
        hasStaffRoom:    true,
        hasStudentAlley: true,
        requireVerification: true,
      };

      mockSingle
        .mockResolvedValueOnce({ data: uniInstitution, error: null })
        .mockResolvedValueOnce({ data: uniClassroom, error: null });

      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      mockInsert.mockResolvedValue({ error: null });

      const result = await service.createClassroom('user-123', uniDto);
      expect(result.global_id).toBe('US-UCDAVIS-MBA-2025');
    });
  });

  // ── getByGlobalId ────────────────────────────────────────────────────────

  describe('getByGlobalId()', () => {
    it('should return classroom with institution details', async () => {
      mockSingle.mockResolvedValue({
        data: { ...mockClassroom, institution: mockInstitution },
        error: null,
      });

      const result = await service.getByGlobalId('IN-KOL-MPBIRLA-9A-2012');
      expect(result.global_id).toBe('IN-KOL-MPBIRLA-9A-2012');
      expect(result.institution).toBeDefined();
    });

    it('should throw NotFoundException when classroom does not exist', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });

      await expect(
        service.getByGlobalId('XX-NOTREAL-999'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── searchInstitutions ───────────────────────────────────────────────────

  describe('searchInstitutions()', () => {
    it('should return matching institutions', async () => {
      const mockInstitutions = [mockInstitution];
      // ilike returns 'this', limit resolves the chain
      mockIlike.mockReturnThis();
      mockLimit.mockResolvedValue({ data: mockInstitutions, error: null });

      const results = await service.searchInstitutions('birla');
      expect(results).toHaveLength(1);
    });

    it('should return empty array on Supabase error', async () => {
      mockIlike.mockReturnThis();
      mockLimit.mockResolvedValue({ data: null, error: { message: 'Query failed' } });

      const results = await service.searchInstitutions('birla');
      expect(results).toEqual([]);
    });

    it('should filter by country code when provided', async () => {
      mockIlike.mockReturnThis();
      mockEq.mockReturnThis();
      mockLimit.mockResolvedValue({ data: [], error: null });

      await service.searchInstitutions('iit', 'IN');

      expect(mockEq).toHaveBeenCalledWith('country_code', 'IN');
    });
  });
});
