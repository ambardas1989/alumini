/**
 * Unit tests for VerificationService.
 *
 * Covers the three numbered security fixes explicitly, plus the rest of
 * SPEC.md §8's six methods:
 *
 * #1 OTP brute-force protection: no-OTP, expired, wrong code (not yet
 *    exhausted), wrong code (exhausts on this attempt), already-exhausted
 *    row, and correct code.
 * #2 Batch code race fix: redemption goes through the redeem_batch_code()
 *    RPC, not check-then-update; RPC returning null (lost the race / cap
 *    reached) is rejected cleanly.
 * #3 Admin ownership check: adminApproveDocument()/adminRejectDocument()
 *    reject an admin who isn't a verified admin of THAT classroom.
 *
 * Also: peer vouching's point-based (student/other vouchee) vs count-based
 * (teacher vouchee) thresholds, teacher-vouching-a-teacher not counting
 * toward the teacher threshold, document submission, LinkedIn matching,
 * and the ownership check on GET status.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';

import { VerificationService } from './verification.service';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType, MemberRole, VerificationMethod } from '@alumini/types';
import { appConfig } from '@alumini/config/app';

// ── Supabase mock (sequenced per table, plus a separate rpc mock) ──────────

let fromTables: Record<string, any> = {};
const mockRpc = jest.fn();

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'eq', 'order', 'limit'].forEach((method) => {
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
    rpc: (...args: any[]) => mockRpc(...args),
  })),
}));

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ── Test suite ───────────────────────────────────────────────────────────────

const mockAppLogger = { setContext: jest.fn().mockReturnThis(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('VerificationService', () => {
  let service: VerificationService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockEventEmit = jest.fn();

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    mockRpc.mockReset();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        { provide: EventEmitter2, useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() } },
        { provide: AppLogger, useValue: mockAppLogger },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
  });

  // ── Method 1: Institutional email OTP ────────────────────────────────────

  describe('initiateEmailVerification()', () => {
    it('throws BadRequestException when the institution has no email_domain', async () => {
      mockTables({
        classrooms: chain({ data: { institution: { email_domain: null } }, error: null }),
      });

      await expect(
        service.initiateEmailVerification('user-1', 'a@school.edu', 'class-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when the email domain doesn't match", async () => {
      mockTables({
        classrooms: chain({ data: { institution: { email_domain: 'school.edu' } }, error: null }),
      });

      await expect(
        service.initiateEmailVerification('user-1', 'a@other.com', 'class-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores a hashed OTP and emits the plaintext code for delivery', async () => {
      mockTables({
        classrooms: chain({ data: { institution: { email_domain: 'school.edu' } }, error: null }),
        verification_email_otps: chain(
          { data: null, error: null }, // invalidate old OTPs
          { data: null, error: null }, // insert new OTP
        ),
      });

      await service.initiateEmailVerification('user-1', 'me@school.edu', 'class-1');

      expect(mockEventEmit).toHaveBeenCalledWith(
        'verification.email.initiate',
        expect.objectContaining({ userId: 'user-1', code: expect.stringMatching(/^\d{6}$/) }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.VERIFICATION_SUBMITTED }),
      );
    });
  });

  describe('confirmEmailOtp() — OTP brute-force protection (security fix #1)', () => {
    it('throws BadRequestException when there is no pending OTP', async () => {
      mockTables({ verification_email_otps: chain({ data: null, error: null }) });

      await expect(service.confirmEmailOtp('user-1', 'class-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired OTP even with the correct code', async () => {
      mockTables({
        verification_email_otps: chain(
          {
            data: { id: 'otp-1', code_hash: sha256('123456'), attempts: 0, expires_at: new Date(Date.now() - 1000).toISOString() },
            error: null,
          },
          { data: null, error: null }, // consumed update
        ),
      });

      await expect(service.confirmEmailOtp('user-1', 'class-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects immediately once max attempts have already been reached', async () => {
      mockTables({
        verification_email_otps: chain({
          data: {
            id: 'otp-1',
            code_hash: sha256('123456'),
            attempts: appConfig.EMAIL_OTP_MAX_ATTEMPTS,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          error: null,
        }),
      });

      await expect(service.confirmEmailOtp('user-1', 'class-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('increments attempts on a wrong code without exhausting it early', async () => {
      mockTables({
        verification_email_otps: chain(
          {
            data: {
              id: 'otp-1',
              code_hash: sha256('123456'),
              attempts: 0,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
            error: null,
          },
          { data: null, error: null }, // attempts++ update
        ),
      });

      await expect(service.confirmEmailOtp('user-1', 'class-1', '000000')).rejects.toThrow(
        'Incorrect verification code.',
      );
    });

    it('exhausts the OTP on the attempt that reaches EMAIL_OTP_MAX_ATTEMPTS', async () => {
      mockTables({
        verification_email_otps: chain(
          {
            data: {
              id: 'otp-1',
              code_hash: sha256('123456'),
              attempts: appConfig.EMAIL_OTP_MAX_ATTEMPTS - 1,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
            error: null,
          },
          { data: null, error: null },
        ),
      });

      await expect(service.confirmEmailOtp('user-1', 'class-1', '000000')).rejects.toThrow(
        'Too many incorrect attempts. Please request a new code.',
      );
    });

    it('approves the membership on a correct, unexpired, unexhausted code', async () => {
      mockTables({
        verification_email_otps: chain(
          {
            data: {
              id: 'otp-1',
              code_hash: sha256('123456'),
              attempts: 0,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
            error: null,
          },
          { data: null, error: null }, // consumed update
        ),
        memberships: chain({ data: null, error: null }), // approveVerification's update
      });

      const result = await service.confirmEmailOtp('user-1', 'class-1', '123456');

      expect(result).toEqual({ verified: true });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.VERIFICATION_APPROVED }),
      );
    });
  });

  // ── Method 2: Peer vouching ──────────────────────────────────────────────

  describe('addVouch()', () => {
    it('throws BadRequestException when vouching for yourself', async () => {
      await expect(service.addVouch('user-1', 'user-1', 'class-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when the voucher is not verified', async () => {
      mockTables({
        memberships: chain({ data: { role: MemberRole.STUDENT, verification_status: 'pending' }, error: null }),
      });

      await expect(service.addVouch('voucher-1', 'vouchee-1', 'class-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the vouchee has not joined the classroom', async () => {
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.STUDENT, verification_status: 'verified' }, error: null },
          { data: null, error: null },
        ),
      });

      await expect(service.addVouch('voucher-1', 'vouchee-1', 'class-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException on a duplicate vouch', async () => {
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.STUDENT, verification_status: 'verified' }, error: null },
          { data: { id: 'm2', role: MemberRole.STUDENT }, error: null },
        ),
        verifications: chain({
          data: { id: 'v1', vouches: [{ user_id: 'voucher-1', role: 'student', vouched_at: '2024-01-01' }] },
          error: null,
        }),
      });

      await expect(service.addVouch('voucher-1', 'vouchee-1', 'class-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('records a vouch WITHOUT full_name and does not verify below threshold', async () => {
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.STUDENT, verification_status: 'verified' }, error: null },
          { data: { id: 'm2', role: MemberRole.STUDENT }, error: null },
        ),
        verifications: chain(
          { data: null, error: null }, // no existing record
          { data: { id: 'v1', vouches: [] }, error: null }, // insert
          { data: null, error: null }, // update with new vouches array
        ),
      });

      const result = await service.addVouch('voucher-1', 'vouchee-1', 'class-1');

      expect(result.isVerified).toBe(false);
      expect(result.vouchPoints).toBe(appConfig.VOUCH_POINTS_STUDENT);
      expect(result.required).toBe(appConfig.VOUCH_POINTS_REQUIRED);
    });

    it('auto-approves a student vouchee once point threshold is met', async () => {
      // One existing teacher vouch (1.5pt) + this new teacher vouch (1.5pt) = 3pt = threshold
      mockTables({
        memberships: chain(
          { data: { role: MemberRole.TEACHER, verification_status: 'verified' }, error: null },
          { data: { id: 'm2', role: MemberRole.STUDENT }, error: null },
          { data: null, error: null }, // approveVerification's membership update
        ),
        verifications: chain(
          {
            data: {
              id: 'v1',
              vouches: [{ user_id: 'other-teacher', role: MemberRole.TEACHER, vouched_at: '2024-01-01' }],
            },
            error: null,
          },
          { data: null, error: null },
        ),
      });

      const result = await service.addVouch('teacher-2', 'vouchee-1', 'class-1');

      expect(result.isVerified).toBe(true);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.VERIFICATION_APPROVED,
          metadata: expect.objectContaining({ method: VerificationMethod.PEER_VOUCH }),
        }),
      );
    });

    it('verifies a TEACHER vouchee by student-vouch COUNT, not points', async () => {
      const fourStudentVouches = Array.from({ length: appConfig.TEACHER_STUDENT_VOUCHES_REQUIRED - 1 }, (_, i) => ({
        user_id: `student-${i}`,
        role: MemberRole.STUDENT,
        vouched_at: '2024-01-01',
      }));

      mockTables({
        memberships: chain(
          { data: { role: MemberRole.STUDENT, verification_status: 'verified' }, error: null },
          { data: { id: 'm2', role: MemberRole.TEACHER }, error: null }, // vouchee is a TEACHER
          { data: null, error: null }, // approveVerification update
        ),
        verifications: chain(
          { data: { id: 'v1', vouches: fourStudentVouches }, error: null },
          { data: null, error: null },
        ),
      });

      const result = await service.addVouch('student-final', 'teacher-vouchee', 'class-1');

      expect(result.isVerified).toBe(true);
      expect(result.required).toBe(appConfig.TEACHER_STUDENT_VOUCHES_REQUIRED);
    });

    it('does NOT count a teacher vouching for a teacher toward the student-vouch threshold', async () => {
      const fourStudentVouches = Array.from({ length: appConfig.TEACHER_STUDENT_VOUCHES_REQUIRED - 1 }, (_, i) => ({
        user_id: `student-${i}`,
        role: MemberRole.STUDENT,
        vouched_at: '2024-01-01',
      }));

      mockTables({
        memberships: chain(
          { data: { role: MemberRole.TEACHER, verification_status: 'verified' }, error: null }, // voucher is a TEACHER
          { data: { id: 'm2', role: MemberRole.TEACHER }, error: null }, // vouchee is a TEACHER
        ),
        verifications: chain(
          { data: { id: 'v1', vouches: fourStudentVouches }, error: null },
          { data: null, error: null },
        ),
      });

      const result = await service.addVouch('teacher-voucher', 'teacher-vouchee', 'class-1');

      // Still 4 qualifying (student) vouches — the 5th was from a teacher, doesn't count
      expect(result.isVerified).toBe(false);
      expect(result.vouchPoints).toBe(appConfig.TEACHER_STUDENT_VOUCHES_REQUIRED - 1);
    });
  });

  // ── Method 3: Document upload ────────────────────────────────────────────

  describe('submitDocument()', () => {
    it('throws BadRequestException when not a member', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      await expect(service.submitDocument('user-1', 'class-1', 'path/to/doc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('stores the storage path and emits an admin-notification event', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        verifications: chain({ data: null, error: null }),
      });

      const result = await service.submitDocument('user-1', 'class-1', 'path/to/doc');

      expect(result.message).toBeDefined();
      expect(mockEventEmit).toHaveBeenCalledWith(
        'verification.document.submitted',
        expect.objectContaining({ userId: 'user-1', classroomId: 'class-1' }),
      );
    });
  });

  describe('adminApproveDocument() — admin ownership check (security fix #3)', () => {
    it('throws NotFoundException for a missing verification record', async () => {
      mockTables({ verifications: chain({ data: null, error: null }) });

      await expect(service.adminApproveDocument('admin-1', 'verification-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when the caller doesn't administer THAT classroom", async () => {
      mockTables({
        verifications: chain({
          data: { user_id: 'applicant-1', classroom_id: 'class-1', status: 'pending', document_storage_path: 'p' },
          error: null,
        }),
        memberships: chain({ data: null, error: null }), // not an admin there
        // classrooms/personas default to { data: null, error: null } —
        // the school_admin fallback below also finds nothing, so this
        // still throws even after the authorization-gap fix.
      });

      await expect(service.adminApproveDocument('not-this-classrooms-admin', 'verification-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('approves for a school_admin persona holder who is NOT a classroom member (authorization gap fix)', async () => {
      mockTables({
        verifications: chain(
          {
            data: { user_id: 'applicant-1', classroom_id: 'class-1', status: 'pending', document_storage_path: 'p/doc' },
            error: null,
          },
          { data: null, error: null }, // status update
        ),
        memberships: chain(
          { data: null, error: null }, // assertClassroomAdmin's membership check — no membership row at all
          { data: null, error: null }, // approveVerification's membership update
        ),
        classrooms: chain({ data: { institution_id: 'inst-1' }, error: null }),
        personas: chain({ data: { id: 'school-admin-persona' }, error: null }), // active school_admin at inst-1
      });

      await expect(
        service.adminApproveDocument('school-admin-1', 'verification-1'),
      ).resolves.not.toThrow();

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.ADMIN_VERIFICATION_APPROVED }),
      );
    });

    it('throws BadRequestException when already processed (admin check still passes first)', async () => {
      mockTables({
        verifications: chain({
          data: { user_id: 'applicant-1', classroom_id: 'class-1', status: 'approved', document_storage_path: 'p' },
          error: null,
        }),
        memberships: chain({ data: { id: 'admin-membership', role: 'admin' }, error: null }),
      });

      await expect(service.adminApproveDocument('admin-1', 'verification-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('approves, schedules storage deletion, and audits for a legitimate classroom admin', async () => {
      mockTables({
        verifications: chain(
          {
            data: { user_id: 'applicant-1', classroom_id: 'class-1', status: 'pending', document_storage_path: 'p/doc' },
            error: null,
          },
          { data: null, error: null }, // status update
        ),
        memberships: chain(
          { data: { id: 'admin-membership', role: 'admin' }, error: null }, // assertClassroomAdmin
          { data: null, error: null }, // approveVerification update
        ),
      });

      await service.adminApproveDocument('admin-1', 'verification-1');

      expect(mockEventEmit).toHaveBeenCalledWith(
        'verification.document.approved',
        expect.objectContaining({ storagePath: 'p/doc' }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.ADMIN_VERIFICATION_APPROVED }),
      );
    });
  });

  describe('adminRejectDocument() — admin ownership check (security fix #3)', () => {
    it("throws ForbiddenException when the caller doesn't administer THAT classroom", async () => {
      mockTables({
        verifications: chain({
          data: { user_id: 'applicant-1', classroom_id: 'class-1', status: 'pending' },
          error: null,
        }),
        memberships: chain({ data: null, error: null }),
      });

      await expect(
        service.adminRejectDocument('not-this-classrooms-admin', 'verification-1', 'insufficient evidence'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects with a reason for a legitimate classroom admin', async () => {
      mockTables({
        verifications: chain(
          { data: { user_id: 'applicant-1', classroom_id: 'class-1', status: 'pending' }, error: null },
          { data: null, error: null },
        ),
        memberships: chain({ data: { id: 'admin-membership', role: 'admin' }, error: null }),
      });

      await service.adminRejectDocument('admin-1', 'verification-1', 'Document unreadable');

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.ADMIN_VERIFICATION_REJECTED,
          metadata: expect.objectContaining({ reason: 'Document unreadable' }),
        }),
      );
    });
  });

  // ── Method 4: LinkedIn import ─────────────────────────────────────────────

  describe('verifyViaLinkedin()', () => {
    it('throws BadRequestException when LinkedIn is not verified on the profile', async () => {
      mockTables({ profiles: chain({ data: { linkedin_verified: false }, error: null }) });

      await expect(service.verifyViaLinkedin('user-1', 'class-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the classroom does not exist', async () => {
      mockTables({
        profiles: chain({ data: { linkedin_verified: true, linkedin_education: [] }, error: null }),
        classrooms: chain({ data: null, error: null }),
      });

      await expect(service.verifyViaLinkedin('user-1', 'class-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no education entry matches', async () => {
      mockTables({
        profiles: chain({
          data: { linkedin_verified: true, linkedin_education: [{ schoolName: 'Some Other School', endYear: 2020 }] },
          error: null,
        }),
        classrooms: chain({
          data: { batch_year: 2012, institution: { name: 'MP Birla School', slug: 'MPBIRLA' } },
          error: null,
        }),
      });

      await expect(service.verifyViaLinkedin('user-1', 'class-1')).rejects.toThrow(BadRequestException);
    });

    it('auto-approves on a matching institution name and graduation year', async () => {
      mockTables({
        profiles: chain({
          data: { linkedin_verified: true, linkedin_education: [{ schoolName: 'MP Birla School', endYear: 2012 }] },
          error: null,
        }),
        classrooms: chain({
          data: { batch_year: 2012, institution: { name: 'MP Birla School', slug: 'MPBIRLA' } },
          error: null,
        }),
        memberships: chain({ data: null, error: null }),
      });

      const result = await service.verifyViaLinkedin('user-1', 'class-1');

      expect(result).toEqual({ verified: true });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.VERIFICATION_APPROVED,
          metadata: expect.objectContaining({ method: VerificationMethod.LINKEDIN }),
        }),
      );
    });
  });

  // ── Methods 5 & 6: Institution codes ─────────────────────────────────────

  describe('redeemCode()', () => {
    it('throws BadRequestException for a badly formatted code', async () => {
      await expect(service.redeemCode('user-1', 'class-1', 'not-a-code')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the code is not found', async () => {
      mockTables({ institution_codes: chain({ data: null, error: null }) });

      await expect(service.redeemCode('user-1', 'class-1', 'IN-2026-A7K2PQ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the code is expired', async () => {
      mockTables({
        institution_codes: chain({
          data: { type: 'personal', expires_at: new Date(Date.now() - 1000).toISOString(), is_redeemed: false },
          error: null,
        }),
      });

      await expect(service.redeemCode('user-1', 'class-1', 'IN-2026-A7K2PQ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when a personal code is already redeemed', async () => {
      mockTables({
        institution_codes: chain({
          data: {
            type: 'personal',
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            is_redeemed: true,
          },
          error: null,
        }),
      });

      await expect(service.redeemCode('user-1', 'class-1', 'IN-2026-A7K2PQ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('redeems a valid personal code directly (no RPC involved)', async () => {
      mockTables({
        institution_codes: chain(
          {
            data: {
              id: 'code-1',
              type: 'personal',
              expires_at: new Date(Date.now() + 86_400_000).toISOString(),
              is_redeemed: false,
              institution_id: 'inst-1',
            },
            error: null,
          },
          { data: null, error: null },
        ),
        memberships: chain({ data: null, error: null }),
      });

      const result = await service.redeemCode('user-1', 'class-1', 'IN-2026-A7K2PQ');

      expect(result).toEqual({ verified: true });
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('redeems a batch code via the redeem_batch_code RPC (race fix #2)', async () => {
      mockTables({
        institution_codes: chain({
          data: {
            id: 'code-2',
            type: 'batch',
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            institution_id: 'inst-1',
          },
          error: null,
        }),
        memberships: chain({ data: null, error: null }),
      });
      mockRpc.mockResolvedValue({ data: { id: 'code-2', redemption_count: 4 }, error: null });

      const result = await service.redeemCode('user-1', 'class-1', 'IN-2026-B7K2PQ');

      expect(result).toEqual({ verified: true });
      expect(mockRpc).toHaveBeenCalledWith('redeem_batch_code', {
        p_code: 'IN-2026-B7K2PQ',
        p_classroom_id: 'class-1',
        p_user_id: 'user-1',
      });
    });

    it('rejects when the RPC reports the cap was reached (returns null)', async () => {
      mockTables({
        institution_codes: chain({
          data: {
            id: 'code-2',
            type: 'batch',
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            institution_id: 'inst-1',
          },
          error: null,
        }),
      });
      mockRpc.mockResolvedValue({ data: null, error: null });

      await expect(service.redeemCode('user-1', 'class-1', 'IN-2026-B7K2PQ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when the RPC itself errors', async () => {
      mockTables({
        institution_codes: chain({
          data: {
            id: 'code-2',
            type: 'batch',
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            institution_id: 'inst-1',
          },
          error: null,
        }),
      });
      mockRpc.mockResolvedValue({ data: null, error: { message: 'db error' } });

      await expect(service.redeemCode('user-1', 'class-1', 'IN-2026-B7K2PQ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── Verification status ──────────────────────────────────────────────────

  describe('getStatusByMembership()', () => {
    it('throws NotFoundException for a missing membership', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      await expect(service.getStatusByMembership('user-1', 'membership-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows the membership owner without an admin check', async () => {
      mockTables({
        memberships: chain({
          data: { id: 'm1', user_id: 'user-1', classroom_id: 'class-1', verification_status: 'verified' },
          error: null,
        }),
        verifications: chain({ data: null, error: null }),
      });

      const result = await service.getStatusByMembership('user-1', 'm1');
      expect(result.verificationStatus).toBe('verified');
    });

    it("throws ForbiddenException for a non-owner who isn't a classroom admin", async () => {
      mockTables({
        memberships: chain(
          { data: { id: 'm1', user_id: 'owner-1', classroom_id: 'class-1', verification_status: 'pending' }, error: null },
          { data: null, error: null }, // assertClassroomAdmin fails
        ),
      });

      await expect(service.getStatusByMembership('outsider', 'm1')).rejects.toThrow(ForbiddenException);
    });

    it('allows a verified classroom admin who is not the owner', async () => {
      mockTables({
        memberships: chain(
          { data: { id: 'm1', user_id: 'owner-1', classroom_id: 'class-1', verification_status: 'pending' }, error: null },
          { data: { id: 'admin-membership', role: 'admin' }, error: null },
        ),
        verifications: chain({ data: null, error: null }),
      });

      const result = await service.getStatusByMembership('admin-1', 'm1');
      expect(result.verificationStatus).toBe('pending');
    });
  });
});
