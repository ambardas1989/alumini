/**
 * Unit tests for SearchService.
 *
 * Covers:
 * - searchStudents(): non-teacher rejected, no-verified-classrooms
 *   returns [], classroomId outside the teacher's verified set rejected,
 *   successful search flattens embedded memberships into per-classroom
 *   rows and calls a real ILIKE
 * - getStudentProfile(): non-teacher rejected, no-verified-classrooms
 *   rejected, no-shared-classroom is NotFoundException, successful
 *   profile + shared classrooms
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { SearchService } from './search.service';

// ── Supabase mock (sequenced per table — see prior modules' specs for the same pattern) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'eq', 'in', 'ilike', 'limit'].forEach((method) => {
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

// ── Test suite ───────────────────────────────────────────────────────────────

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SearchService],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  // ── searchStudents() ─────────────────────────────────────────────────────

  describe('searchStudents()', () => {
    it('throws ForbiddenException when the caller has no active teacher persona', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(service.searchStudents('user-1', { q: 'pr' } as any)).rejects.toThrow(ForbiddenException);
    });

    it('returns an empty array when the teacher has no verified classrooms', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        memberships: chain({ data: [], error: null }),
      });

      const result = await service.searchStudents('teacher-1', { q: 'pr' } as any);
      expect(result).toEqual([]);
    });

    it('throws ForbiddenException when classroomId is outside the verified set', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        memberships: chain({ data: [{ classroom_id: 'class-1' }], error: null }),
      });

      await expect(
        service.searchStudents('teacher-1', { q: 'pr', classroomId: 'class-999' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('runs a real ILIKE and flattens embedded memberships into per-classroom rows', async () => {
      const profilesChain = chain({
        data: [
          {
            id: 'student-1',
            full_name: 'Priya Sharma',
            avatar_url: 'https://x/y.png',
            memberships: [
              { classroom_id: 'class-1', role: 'student', verification_status: 'verified', classroom: { id: 'class-1', name: '9A 2012', batch_year: 2012 } },
              { classroom_id: 'class-2', role: 'student', verification_status: 'pending', classroom: { id: 'class-2', name: '10B 2013', batch_year: 2013 } },
            ],
          },
        ],
        error: null,
      });

      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        memberships: chain({ data: [{ classroom_id: 'class-1' }, { classroom_id: 'class-2' }], error: null }),
        profiles: profilesChain,
      });

      const result = await service.searchStudents('teacher-1', { q: 'pri' } as any);

      expect(profilesChain.ilike).toHaveBeenCalledWith('full_name', '%pri%');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({ userId: 'student-1', classroomId: 'class-1', batchYear: 2012, verificationStatus: 'verified' }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({ userId: 'student-1', classroomId: 'class-2', batchYear: 2013, verificationStatus: 'pending' }),
      );
    });

    it('throws BadRequestException when the search query itself fails', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        memberships: chain({ data: [{ classroom_id: 'class-1' }], error: null }),
        profiles: chain({ data: null, error: { message: 'query failed' } }),
      });

      await expect(service.searchStudents('teacher-1', { q: 'pri' } as any)).rejects.toThrow(BadRequestException);
    });
  });

  // ── getStudentProfile() ──────────────────────────────────────────────────

  describe('getStudentProfile()', () => {
    it('throws ForbiddenException when the caller has no active teacher persona', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(service.getStudentProfile('user-1', 'student-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the teacher has no verified classrooms', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        memberships: chain({ data: [], error: null }),
      });

      await expect(service.getStudentProfile('teacher-1', 'student-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when there is no shared classroom', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        memberships: chain(
          { data: [{ classroom_id: 'class-1' }], error: null }, // teacher's verified classrooms
          { data: [], error: null }, // student has no membership in any of them
        ),
      });

      await expect(service.getStudentProfile('teacher-1', 'student-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the profile with every shared classroom', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        memberships: chain(
          { data: [{ classroom_id: 'class-1' }], error: null },
          {
            data: [
              {
                classroom_id: 'class-1',
                role: 'student',
                verification_status: 'verified',
                joined_at: '2024-01-01',
                classroom: { id: 'class-1', name: '9A 2012', batch_year: 2012, global_id: 'IN-KOL-MPBIRLA-9A-2012' },
              },
            ],
            error: null,
          },
        ),
        profiles: chain({
          data: { id: 'student-1', full_name: 'Priya Sharma', avatar_url: 'https://x/y.png', linkedin_url: null },
          error: null,
        }),
      });

      const result = await service.getStudentProfile('teacher-1', 'student-1');

      expect(result.fullName).toBe('Priya Sharma');
      expect(result.sharedClassrooms).toHaveLength(1);
      expect(result.sharedClassrooms[0]).toEqual(
        expect.objectContaining({ classroomId: 'class-1', batchYear: 2012, role: 'student' }),
      );
    });
  });
});
