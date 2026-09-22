/**
 * Unit tests for AdminService.
 *
 * Covers, per the task's explicit priorities:
 * - Admin ownership checks: assertSchoolAdmin() rejection (via getOverview)
 *   and the institution-mismatch check on a verification (getVerificationDocumentUrl/
 *   approveVerificationDocument) — a school admin of one institution cannot
 *   touch a verification that belongs to another
 * - Signed URL generation: missing document, success (audited), and that
 *   the school-admin gate runs before either
 * - Platform admin gating: listPendingClaims()/approveClaim()/rejectClaim()
 *   all reject a non-platform-admin BEFORE ever calling InstitutionService
 *
 * Plus reasonable coverage of the aggregation reads (getClassroomsByYear,
 * getPendingDocumentVerifications, getAnalytics) and both delegation paths
 * (VerificationService, InstitutionService) actually being called with the
 * right arguments.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { AdminService } from './admin.service';
import { AuditService } from '../audit/audit.service';
import { VerificationService } from '../verification/verification.service';
import { InstitutionService } from '../institution/institution.service';
import { AuditEventType } from '@alumini/types';
import { appConfig } from '@alumini/config/app';

// ── Supabase mock (sequenced per table, plus Storage — see prior modules' specs for the table pattern) ──

let fromTables: Record<string, any> = {};
const mockCreateSignedUrl = jest.fn();

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'eq', 'in', 'gte', 'lt', 'order', 'range', 'limit'].forEach((method) => {
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
    storage: {
      from: () => ({ createSignedUrl: (...args: any[]) => mockCreateSignedUrl(...args) }),
    },
  })),
}));

// ── Test suite ───────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockAdminApproveDocument = jest.fn().mockResolvedValue(undefined);
  const mockAdminRejectDocument = jest.fn().mockResolvedValue(undefined);
  const mockApproveClaim = jest.fn().mockResolvedValue({ institutionId: 'inst-1', userId: 'claimant-1', isPrimaryAdmin: true });
  const mockRejectClaim = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        {
          provide: VerificationService,
          useValue: { adminApproveDocument: mockAdminApproveDocument, adminRejectDocument: mockAdminRejectDocument },
        },
        {
          provide: InstitutionService,
          useValue: { approveClaim: mockApproveClaim, rejectClaim: mockRejectClaim },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  // ── Admin ownership: getOverview() as the assertSchoolAdmin() exemplar ──

  describe('getOverview()', () => {
    it('throws ForbiddenException for a non-school-admin (admin ownership check)', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(service.getOverview('user-1', 'inst-1')).rejects.toThrow(ForbiddenException);
    });

    it('returns zeroed counts for an institution with no classrooms', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }, { data: null, error: null, count: 3 }),
        classrooms: chain(
          { data: [], error: null },
          { data: null, error: null, count: 0 },
          { data: null, error: null, count: 0 },
        ),
        institution_codes: chain({ data: [], error: null }),
      });

      const result = await service.getOverview('admin-1', 'inst-1');

      expect(result).toEqual({
        totalClassrooms: 0,
        activeClassrooms: 0,
        totalMembers: 0,
        totalVerifiedMembers: 0,
        pendingVerifications: 0,
        activeCodes: 0,
        totalAdmins: 3,
        recentActivity: [],
        logoUrl: null,
      });
    });

    it('includes recent activity for the institution\'s classrooms', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }, { data: null, error: null, count: 1 }),
        classrooms: chain(
          { data: [{ id: 'c1' }], error: null },
          { data: null, error: null, count: 1 },
        ),
        memberships: chain({ data: null, error: null, count: 5 }),
        verifications: chain({ data: null, error: null, count: 0 }),
        institution_codes: chain({ data: [], error: null }),
        audit_logs: chain({
          data: [
            { id: 'log1', event_type: 'classroom.joined', actor_id: 'u1', target_id: 'c1', metadata: { role: 'student' }, created_at: '2024-01-01' },
          ],
          error: null,
        }),
      });

      const result = await service.getOverview('admin-1', 'inst-1');

      expect(result.recentActivity).toEqual([
        { id: 'log1', eventType: 'classroom.joined', actorId: 'u1', classroomId: 'c1', metadata: { role: 'student' }, createdAt: '2024-01-01' },
      ]);
    });
  });

  // ── getClassroomsByYear() ────────────────────────────────────────────────

  describe('getClassroomsByYear()', () => {
    it('throws ForbiddenException for a non-school-admin', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(service.getClassroomsByYear('user-1', 'inst-1')).rejects.toThrow(ForbiddenException);
    });

    it('groups classrooms by batch year descending, with per-classroom counts', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({
          data: [
            { id: 'c1', global_id: 'G1', name: '9A 2012', batch_year: 2012, grade: '9', section: 'A', program: null, member_count: 10 },
            { id: 'c2', global_id: 'G2', name: '10A 2013', batch_year: 2013, grade: '10', section: 'A', program: null, member_count: 5 },
          ],
          error: null,
        }),
        memberships: chain({
          data: [
            { classroom_id: 'c1', verification_status: 'verified' },
            { classroom_id: 'c1', verification_status: 'verified' },
            { classroom_id: 'c1', verification_status: 'pending' },
            { classroom_id: 'c2', verification_status: 'verified' },
          ],
          error: null,
        }),
      });

      const result = await service.getClassroomsByYear('admin-1', 'inst-1');

      expect(result.map((y) => y.year)).toEqual([2013, 2012]); // descending
      const year2012 = result.find((y) => y.year === 2012)!;
      expect(year2012.classrooms[0]).toEqual(
        expect.objectContaining({ id: 'c1', verifiedCount: 2, pendingCount: 1 }),
      );
      expect(year2012.canAddClassroom).toBe(true);
    });
  });

  // ── getPendingDocumentVerifications() ────────────────────────────────────

  describe('getPendingDocumentVerifications()', () => {
    it('returns an empty array when the institution has no classrooms', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: [], error: null }),
      });

      const result = await service.getPendingDocumentVerifications('admin-1', 'inst-1');
      expect(result).toEqual([]);
    });

    it('never includes document_storage_path and maps display fields correctly', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: [{ id: 'c1', name: '9A 2012' }], error: null }),
        verifications: chain({
          data: [
            { id: 'v1', user_id: 'u1', classroom_id: 'c1', created_at: '2024-01-01T00:00:00Z', profile: { full_name: 'Priya Sharma' } },
          ],
          error: null,
        }),
      });

      const result = await service.getPendingDocumentVerifications('admin-1', 'inst-1');

      expect(result).toEqual([
        {
          verificationId: 'v1',
          userId: 'u1',
          userDisplayName: 'Priya Sharma',
          classroomId: 'c1',
          classroomName: '9A 2012',
          submittedAt: '2024-01-01T00:00:00Z',
        },
      ]);
      expect(result[0]).not.toHaveProperty('documentStoragePath');
    });
  });

  // ── Signed URL generation ────────────────────────────────────────────────

  describe('getVerificationDocumentUrl()', () => {
    // NOTE ON CALL ORDER (post-fix): the verification record is fetched
    // FIRST now (to get its classroomId), THEN
    // assertInstitutionAdminCanAccessClassroom() authorizes — the reverse
    // of the old assertSchoolAdmin-then-fetch order. See admin.service.ts's
    // "✔ FIXED" module comment.

    it('throws NotFoundException when the verification does not exist', async () => {
      mockTables({ verifications: chain({ data: null, error: null }) });

      await expect(service.getVerificationDocumentUrl('user-1', 'inst-1', 'v1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the caller is not an active school admin of this institution', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: 'path/doc.pdf' }, error: null }),
        personas: chain({ data: null, error: null }),
      });

      await expect(service.getVerificationDocumentUrl('user-1', 'inst-1', 'v1')).rejects.toThrow(ForbiddenException);
      expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the classroom does not belong to this institution', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: 'path/doc.pdf' }, error: null }),
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: null, error: null }), // c1 doesn't belong to inst-1
      });

      await expect(service.getVerificationDocumentUrl('admin-1', 'inst-1', 'v1')).rejects.toThrow(NotFoundException);
      expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the verification has no document on file', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: null }, error: null }),
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: { id: 'c1' }, error: null }),
      });

      await expect(service.getVerificationDocumentUrl('admin-1', 'inst-1', 'v1')).rejects.toThrow(NotFoundException);
    });

    it('generates a signed URL and audits the access — WITHOUT requiring a classroom membership row (the fix)', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: 'path/doc.pdf' }, error: null }),
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: { id: 'c1' }, error: null }),
        // Deliberately no `memberships` mock at all — the default fallback
        // (chain({data:null,error:null})) would fail a membership-based
        // check, proving this path never queries memberships.
      });
      mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/doc.pdf' }, error: null });

      const result = await service.getVerificationDocumentUrl('admin-1', 'inst-1', 'v1');

      expect(result).toEqual({
        url: 'https://signed.example/doc.pdf',
        expiresInSeconds: appConfig.DOCUMENT_SIGNED_URL_EXPIRY_SECONDS,
      });
      expect(mockCreateSignedUrl).toHaveBeenCalledWith('path/doc.pdf', appConfig.DOCUMENT_SIGNED_URL_EXPIRY_SECONDS);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.ADMIN_VERIFICATION_DOCUMENT_ACCESSED, targetId: 'v1' }),
      );
    });

    it('throws BadRequestException when Storage itself errors', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: 'path/doc.pdf' }, error: null }),
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: { id: 'c1' }, error: null }),
      });
      mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: 'storage down' } });

      await expect(service.getVerificationDocumentUrl('admin-1', 'inst-1', 'v1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── Delegation: document approve/reject ──────────────────────────────────

  describe('approveVerificationDocument()', () => {
    it('never delegates when the verification does not exist', async () => {
      mockTables({ verifications: chain({ data: null, error: null }) });

      await expect(service.approveVerificationDocument('user-1', 'inst-1', 'v1')).rejects.toThrow(NotFoundException);
      expect(mockAdminApproveDocument).not.toHaveBeenCalled();
    });

    it('never delegates when the caller is not a school admin', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: 'p' }, error: null }),
        personas: chain({ data: null, error: null }),
      });

      await expect(service.approveVerificationDocument('user-1', 'inst-1', 'v1')).rejects.toThrow(ForbiddenException);
      expect(mockAdminApproveDocument).not.toHaveBeenCalled();
    });

    it('never delegates when the classroom does not belong to this institution', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: 'p' }, error: null }),
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: null, error: null }),
      });

      await expect(service.approveVerificationDocument('admin-1', 'inst-1', 'v1')).rejects.toThrow(NotFoundException);
      expect(mockAdminApproveDocument).not.toHaveBeenCalled();
    });

    it('delegates to VerificationService.adminApproveDocument() once ownership is confirmed — no classroom membership required (the fix)', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: 'p' }, error: null }),
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: { id: 'c1' }, error: null }),
        // No `memberships` mock — see the equivalent note on
        // getVerificationDocumentUrl()'s success test.
      });

      await service.approveVerificationDocument('admin-1', 'inst-1', 'v1');

      expect(mockAdminApproveDocument).toHaveBeenCalledWith('admin-1', 'v1', undefined);
    });
  });

  describe('rejectVerificationDocument()', () => {
    it('delegates to VerificationService.adminRejectDocument() with the reason', async () => {
      mockTables({
        verifications: chain({ data: { id: 'v1', classroom_id: 'c1', document_storage_path: 'p' }, error: null }),
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: { id: 'c1' }, error: null }),
      });

      await service.rejectVerificationDocument('admin-1', 'inst-1', 'v1', { reason: 'Blurry photo' } as any);

      expect(mockAdminRejectDocument).toHaveBeenCalledWith('admin-1', 'v1', 'Blurry photo', undefined);
    });
  });

  // ── getAnalytics() ───────────────────────────────────────────────────────

  describe('getAnalytics()', () => {
    it('throws ForbiddenException for a non-school-admin', async () => {
      mockTables({ personas: chain({ data: null, error: null }) });

      await expect(service.getAnalytics('user-1', 'inst-1')).rejects.toThrow(ForbiddenException);
    });

    it('returns zeroed analytics for an institution with no classrooms', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({ data: [], error: null }),
      });

      const result = await service.getAnalytics('admin-1', 'inst-1');

      expect(result).toEqual({
        activeAlumniCount: 0,
        topClassrooms: [],
        verificationMethodBreakdown: {},
        newMembersThisMonth: 0,
        memberGrowth: [],
      });
    });

    it('ranks the top 5 classrooms and breaks down verification methods', async () => {
      mockTables({
        personas: chain({ data: { id: 'p1' }, error: null }),
        classrooms: chain({
          data: [
            { id: 'c1', name: 'Class A', member_count: 5 },
            { id: 'c2', name: 'Class B', member_count: 10 },
          ],
          error: null,
        }),
        memberships: chain(
          { data: null, error: null, count: 12 }, // active alumni count
          {
            data: [
              { verification_method: 'email' },
              { verification_method: 'email' },
              { verification_method: 'peer_vouch' },
            ],
            error: null,
          },
          { data: null, error: null, count: 2 }, // new members this month
        ),
      });

      const result = await service.getAnalytics('admin-1', 'inst-1');

      expect(result.activeAlumniCount).toBe(12);
      expect(result.topClassrooms).toEqual([
        { classroomId: 'c2', name: 'Class B', memberCount: 10 },
        { classroomId: 'c1', name: 'Class A', memberCount: 5 },
      ]);
      expect(result.verificationMethodBreakdown).toEqual({ email: 2, peer_vouch: 1 });
      expect(result.newMembersThisMonth).toBe(2);
    });
  });

  // ── Platform admin gating ────────────────────────────────────────────────

  describe('listPendingClaims()', () => {
    it('throws ForbiddenException for a non-platform-admin', async () => {
      mockTables({ profiles: chain({ data: { is_platform_admin: false }, error: null }) });

      await expect(service.listPendingClaims('user-1')).rejects.toThrow(ForbiddenException);
    });

    it('lists pending claims for a platform admin', async () => {
      mockTables({
        profiles: chain({ data: { is_platform_admin: true }, error: null }),
        personas: chain({
          data: [
            {
              id: 'claim-1', user_id: 'claimant-1', institution_id: 'inst-1', created_at: '2024-01-01',
              profile: { full_name: 'Raj Kumar', email: 'raj@example.com' },
              institution: { name: 'MP Birla School', slug: 'MPBIRLA' },
            },
          ],
          error: null,
        }),
      });

      const result = await service.listPendingClaims('platform-admin-1');

      expect(result).toEqual([
        {
          claimId: 'claim-1',
          userId: 'claimant-1',
          userDisplayName: 'Raj Kumar',
          userEmail: 'raj@example.com',
          institutionId: 'inst-1',
          institutionName: 'MP Birla School',
          submittedAt: '2024-01-01',
        },
      ]);
    });
  });

  describe('approveClaim()', () => {
    it('never delegates to InstitutionService when the caller is not a platform admin', async () => {
      mockTables({ profiles: chain({ data: { is_platform_admin: false }, error: null }) });

      await expect(service.approveClaim('user-1', 'claim-1')).rejects.toThrow(ForbiddenException);
      expect(mockApproveClaim).not.toHaveBeenCalled();
    });

    it('delegates to InstitutionService.approveClaim() for a platform admin', async () => {
      mockTables({ profiles: chain({ data: { is_platform_admin: true }, error: null }) });

      await service.approveClaim('platform-admin-1', 'claim-1');

      expect(mockApproveClaim).toHaveBeenCalledWith('platform-admin-1', 'claim-1', undefined);
    });
  });

  describe('rejectClaim()', () => {
    it('never delegates to InstitutionService when the caller is not a platform admin', async () => {
      mockTables({ profiles: chain({ data: null, error: null }) });

      await expect(service.rejectClaim('user-1', 'claim-1', { reason: 'no' } as any)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockRejectClaim).not.toHaveBeenCalled();
    });

    it('delegates to InstitutionService.rejectClaim() with the reason for a platform admin', async () => {
      mockTables({ profiles: chain({ data: { is_platform_admin: true }, error: null }) });

      await service.rejectClaim('platform-admin-1', 'claim-1', { reason: 'Could not verify' } as any);

      expect(mockRejectClaim).toHaveBeenCalledWith('platform-admin-1', 'claim-1', { reason: 'Could not verify' }, undefined);
    });
  });

  // ── Institution requests (platform admin only) ───────────────────────────

  describe('listInstitutionRequests()', () => {
    it('throws ForbiddenException for a non-platform-admin', async () => {
      mockTables({ profiles: chain({ data: { is_platform_admin: false }, error: null }) });

      await expect(service.listInstitutionRequests('user-1')).rejects.toThrow(ForbiddenException);
    });

    it('lists pending requests for a platform admin', async () => {
      mockTables({
        profiles: chain({ data: { is_platform_admin: true }, error: null }),
        institution_requests: chain({ data: [{ id: 'req-1', name: 'New School', status: 'pending' }], error: null }),
      });

      const result = await service.listInstitutionRequests('platform-admin-1');
      expect(result).toEqual([{ id: 'req-1', name: 'New School', status: 'pending' }]);
    });
  });

  describe('approveInstitutionRequest()', () => {
    it('throws ForbiddenException for a non-platform-admin', async () => {
      mockTables({ profiles: chain({ data: { is_platform_admin: false }, error: null }) });

      await expect(
        service.approveInstitutionRequest('user-1', 'req-1', { slug: 'NEWSCH' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the request is not pending', async () => {
      mockTables({
        profiles: chain({ data: { is_platform_admin: true }, error: null }),
        institution_requests: chain({ data: { id: 'req-1', status: 'approved' }, error: null }),
      });

      await expect(
        service.approveInstitutionRequest('platform-admin-1', 'req-1', { slug: 'NEWSCH' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the institution and marks the request approved', async () => {
      mockTables({
        profiles: chain({ data: { is_platform_admin: true }, error: null }),
        institution_requests: chain(
          { data: { id: 'req-1', name: 'New School', type: 'school', country_code: 'IN', status: 'pending' }, error: null },
          { data: null, error: null }, // update
        ),
        institutions: chain(
          { data: null, error: null }, // slug not taken
          { data: { id: 'inst-1', name: 'New School', slug: 'NEWSCH' }, error: null }, // insert
        ),
      });

      const result = await service.approveInstitutionRequest('platform-admin-1', 'req-1', { slug: 'NEWSCH' } as any);

      expect(result).toEqual({ institution: { id: 'inst-1', name: 'New School', slug: 'NEWSCH' }, message: 'Approved' });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.INSTITUTION_REQUEST_APPROVED }),
      );
    });
  });

  describe('rejectInstitutionRequest()', () => {
    it('throws ForbiddenException for a non-platform-admin', async () => {
      mockTables({ profiles: chain({ data: { is_platform_admin: false }, error: null }) });

      await expect(
        service.rejectInstitutionRequest('user-1', 'req-1', { reason: 'no' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('marks the request rejected with a reason', async () => {
      mockTables({
        profiles: chain({ data: { is_platform_admin: true }, error: null }),
        institution_requests: chain(
          { data: { id: 'req-1', name: 'New School', status: 'pending' }, error: null },
          { data: null, error: null }, // update
        ),
      });

      const result = await service.rejectInstitutionRequest('platform-admin-1', 'req-1', { reason: 'Duplicate' } as any);

      expect(result).toEqual({ message: 'Rejected' });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.INSTITUTION_REQUEST_REJECTED }),
      );
    });
  });
});
