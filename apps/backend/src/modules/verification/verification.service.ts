/**
 * VerificationService — handles all 6 verification methods.
 *
 * Methods:
 * 1. Institutional email OTP (secondary address, permanent record)
 * 2. Peer vouching (3pts, teachers = 1.5pts; teacher VOUCHEES use a
 *    separate count-based threshold — see addVouch())
 * 3. Document upload (admin reviews, auto-deleted 30 days)
 * 4. LinkedIn graduation import
 * 5. Personal institution code (name-tied, single-use)
 * 6. Batch code (capped to class size, redeemed via an atomic SQL RPC)
 *
 * IMPORTANT: All verification state changes write to audit_logs.
 * Document storage paths are NEVER returned to clients.
 * Signed URLs are generated on-demand for admin review only.
 *
 * SECURITY FIXES FROM THE ORIGINAL SCAFFOLD REVIEW (all addressed here):
 * #1 confirmEmailOtp() used to accept ANY code (`const isValid = true`).
 *    Real hashed/expiring/attempt-limited OTP storage now backs it —
 *    see verification_email_otps in 004_verification_module.sql and the
 *    hashOtp()/generateNumericCode() helpers below.
 * #2 redeemCode() used a check-then-update pattern for BATCH codes, which
 *    is a TOCTOU race: two concurrent requests could both read
 *    redemption_count < max_redemptions before either write landed. It now
 *    calls the redeem_batch_code() SECURITY DEFINER SQL function
 *    (001_initial_schema.sql), which holds a row lock for the whole
 *    check-and-increment.
 * #3 adminApproveDocument()/adminRejectDocument() never checked that the
 *    calling admin actually administers the classroom the verification
 *    belongs to — any authenticated caller passing a valid verificationId
 *    could approve/reject it. assertClassroomAdmin() now guards both.
 *
 * Also fixed: addVouch() used to store the voucher's full_name in the
 * vouches jsonb column — SPEC.md §19.5 (right-to-erasure) and
 * 001_initial_schema.sql's own column comment both say user_id + role
 * only, joined from profiles at read time. That's now what happens.
 */

import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomInt } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import {
  AuditEventType,
  ErrorCode,
  VerificationMethod,
  PersonaType,
  MemberRole,
} from '@alumini/types';
import {
  calculateVouchPoints,
  isVouchThresholdMet,
  daysFromNow,
  isExpired,
  isValidInstitutionCode,
} from '@alumini/utils';
import { appConfig } from '@alumini/config/app';
import { Request } from 'express';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(
    private readonly audit: AuditService,
    private readonly eventEmitter: EventEmitter2,
    appLogger: AppLogger,
  ) {
    this.appLogger = appLogger.setContext('VERIFY');
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Method 1: Institutional Email ─────────────────────────────────────────

  /**
   * Step 1: User adds a secondary institutional email.
   * Sends a one-time code to that email.
   * Does NOT change their login email.
   *
   * @param userId - User's profile ID
   * @param institutionalEmail - The institutional email to verify
   * @param classroomId - The classroom they're trying to verify for
   */
  async initiateEmailVerification(
    userId: string,
    institutionalEmail: string,
    classroomId: string,
    req?: Request,
  ): Promise<void> {
    this.appLogger.debug('[VERIFY:email] entry', { userId, classroomId });

    // Check that the institution domain matches this classroom's institution
    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('institution:institutions(email_domain)')
      .eq('id', classroomId)
      .single();

    const institutionDomain = (classroom?.institution as any)?.email_domain;

    if (!institutionDomain) {
      throw new BadRequestException(
        'This institution does not support email verification. Please use another method.',
      );
    }

    const userDomain = institutionalEmail.split('@')[1];
    const domainMatches =
      userDomain === institutionDomain ||
      userDomain.endsWith(`.${institutionDomain}`);

    this.appLogger.debug('[VERIFY:email] domain check', { userDomain, institutionDomain, matches: domainMatches });

    if (!domainMatches) {
      this.appLogger.warn('[VERIFY:email] no match', { userId, classroomId });
      throw new BadRequestException(
        `Email domain must match @${institutionDomain}`,
      );
    }

    // Invalidate any still-outstanding OTP for this (user, classroom) pair
    // first — otherwise a user who requests a code twice would have two
    // simultaneously-valid codes, and only the newest one was actually
    // delivered to them.
    await this.supabase
      .from('verification_email_otps')
      .update({ consumed: true })
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .eq('consumed', false);

    const code = this.generateNumericCode(appConfig.EMAIL_OTP_LENGTH);
    const expiresAt = new Date(Date.now() + appConfig.EMAIL_OTP_EXPIRY_MINUTES * 60_000);

    const { error: otpError } = await this.supabase.from('verification_email_otps').insert({
      user_id:             userId,
      classroom_id:        classroomId,
      institutional_email: institutionalEmail,
      code_hash:           this.hashOtp(code),
      expires_at:          expiresAt.toISOString(),
    });

    if (otpError) {
      this.appLogger.error('[VERIFY:email] failed', {
        userId,
        classroomId,
        error: otpError.message,
        code: otpError.code,
        hint: otpError.hint,
        details: otpError.details,
      });
      throw new BadRequestException('Failed to start email verification. Please try again.');
    }

    // Delivery (Resend credentials/templates) belongs to the notification
    // module — this module only generates and stores the OTP, then hands
    // off the plaintext code for sending. Same pattern as
    // AuthService.initiateSmsChallenge().
    this.eventEmitter.emit('verification.email.initiate', {
      userId,
      institutionalEmail,
      classroomId,
      code,
      expiresAt,
    });

    await this.audit.log({
      eventType:  AuditEventType.VERIFICATION_SUBMITTED,
      actorId:    userId,
      targetId:   classroomId,
      targetType: 'classroom',
      metadata: {
        method:     VerificationMethod.EMAIL,
        email_domain: userDomain,  // Domain only, not full email
      },
      req,
    });
  }

  /**
   * Step 2: User confirms the OTP sent to their institutional email.
   * On success: membership becomes verified.
   * The verification record is permanent — even after the email expires.
   *
   * SECURITY (fixes issue #1 — see module header): validates against the
   * hashed, expiring, attempt-limited row created by
   * initiateEmailVerification(). Never compares against a hardcoded value.
   */
  async confirmEmailOtp(
    userId: string,
    classroomId: string,
    otp: string,
    req?: Request,
  ): Promise<{ verified: boolean }> {
    const { data: otpRow } = await this.supabase
      .from('verification_email_otps')
      .select('id, code_hash, attempts, expires_at')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .eq('consumed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRow) {
      throw new BadRequestException('No pending verification code found. Please request a new one.');
    }

    if (isExpired(otpRow.expires_at)) {
      await this.supabase.from('verification_email_otps').update({ consumed: true }).eq('id', otpRow.id);
      throw new BadRequestException({
        message: 'This code has expired. Please request a new one.',
        error: ErrorCode.VERIFICATION_OTP_EXPIRED,
      });
    }

    if (otpRow.attempts >= appConfig.EMAIL_OTP_MAX_ATTEMPTS) {
      // Should already be consumed by the branch below, but guards against
      // a row that was exhausted by a previous request in the same window.
      throw new BadRequestException({
        message: 'Too many incorrect attempts. Please request a new code.',
        error: ErrorCode.VERIFICATION_OTP_MAX_ATTEMPTS,
      });
    }

    const isValid = otpRow.code_hash === this.hashOtp(otp);

    if (!isValid) {
      const attempts = otpRow.attempts + 1;
      const exhausted = attempts >= appConfig.EMAIL_OTP_MAX_ATTEMPTS;

      // Brute-force protection: once exhausted, this row can never be used
      // again — even if the caller's next guess would have been correct.
      await this.supabase
        .from('verification_email_otps')
        .update({ attempts, consumed: exhausted })
        .eq('id', otpRow.id);

      throw new BadRequestException(
        exhausted
          ? { message: 'Too many incorrect attempts. Please request a new code.', error: ErrorCode.VERIFICATION_OTP_MAX_ATTEMPTS }
          : { message: 'Incorrect verification code.', error: ErrorCode.VERIFICATION_OTP_INVALID },
      );
    }

    // Correct code — single use.
    await this.supabase.from('verification_email_otps').update({ consumed: true }).eq('id', otpRow.id);

    this.appLogger.info('[VERIFY:email] matched', { userId, classroomId });
    await this.approveVerification(
      userId,
      classroomId,
      VerificationMethod.EMAIL,
      req,
    );

    return { verified: true };
  }

  // ── Method 2: Peer Vouching ───────────────────────────────────────────────

  /**
   * A verified member vouches for an unverified member.
   *
   * Rules:
   * - Voucher must be verified in this classroom
   * - Voucher cannot vouch for themselves
   * - Each voucher can only vouch once per vouchee per classroom
   * - Threshold depends on the VOUCHEE's role (SPEC.md §8.2/§8.3):
   *     student/other → point-based: VOUCH_POINTS_REQUIRED, student=1pt,
   *       teacher=1.5pt (calculateVouchPoints/isVouchThresholdMet)
   *     teacher        → count-based: TEACHER_STUDENT_VOUCHES_REQUIRED
   *       vouches specifically FROM STUDENTS in this classroom (a
   *       teacher-vouching-for-a-teacher does not count toward this —
   *       SPEC.md §8.2 only credits student vouches for the teacher path)
   *
   * PRIVACY (SPEC.md §19.5, fixes the full_name issue flagged in review):
   * vouches jsonb stores {user_id, role, vouched_at} ONLY. Never full_name
   * — display names are joined from profiles at read time by whatever
   * calls that later, so a right-to-erasure request doesn't need to hunt
   * through jsonb blobs across every classroom a user ever vouched in.
   *
   * @param voucherId - ID of the verified user doing the vouching
   * @param voucheeId - ID of the unverified user being vouched for
   * @param classroomId - The classroom context
   */
  async addVouch(
    voucherId: string,
    voucheeId: string,
    classroomId: string,
    req?: Request,
  ): Promise<{ vouchPoints: number; required: number; isVerified: boolean }> {
    this.appLogger.debug('[VERIFY:vouch] entry', { voucherId, voucheeId, classroomId });

    // Cannot vouch for yourself
    if (voucherId === voucheeId) {
      throw new BadRequestException('You cannot vouch for yourself');
    }

    // Voucher must be a verified member of this classroom
    const { data: voucherMembership } = await this.supabase
      .from('memberships')
      .select('role, verification_status')
      .eq('user_id', voucherId)
      .eq('classroom_id', classroomId)
      .single();

    this.appLogger.debug('[VERIFY:vouch] voucher check', { isVerified: voucherMembership?.verification_status === 'verified' });

    if (!voucherMembership || voucherMembership.verification_status !== 'verified') {
      throw new ForbiddenException(
        'You must be a verified member of this classroom to vouch for others',
      );
    }

    // The vouchee's role decides which threshold applies below — fetched
    // once, up front, whether or not a verification record already exists.
    const { data: voucheeMembership } = await this.supabase
      .from('memberships')
      .select('id, role')
      .eq('user_id', voucheeId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!voucheeMembership) {
      throw new NotFoundException('The person you are vouching for has not joined this classroom');
    }

    // Get or create the peer_vouch verification record for the vouchee
    let { data: verification } = await this.supabase
      .from('verifications')
      .select('*')
      .eq('user_id', voucheeId)
      .eq('classroom_id', classroomId)
      .eq('method', VerificationMethod.PEER_VOUCH)
      .eq('status', 'pending')
      .maybeSingle();

    if (!verification) {
      const { data: newVerification } = await this.supabase
        .from('verifications')
        .insert({
          membership_id: voucheeMembership.id,
          user_id:       voucheeId,
          classroom_id:  classroomId,
          method:        VerificationMethod.PEER_VOUCH,
          status:        'pending',
          vouches:       [],
          vouch_points:  0,
        })
        .select()
        .single();

      verification = newVerification;
    }

    // Check if this voucher has already vouched for this vouchee
    const existingVouches: any[] = verification.vouches ?? [];
    const alreadyVouched = existingVouches.some(
      (v: any) => v.user_id === voucherId,
    );

    if (alreadyVouched) {
      this.appLogger.warn('[VERIFY:vouch] already vouched', { voucherId, voucheeId });
      throw new BadRequestException(
        'You have already vouched for this person in this classroom',
      );
    }

    // Append the new vouch — user_id + role only, see the privacy note above.
    const newVouch = {
      user_id:    voucherId,
      role:       voucherMembership.role,
      vouched_at: new Date().toISOString(),
    };

    const updatedVouches = [...existingVouches, newVouch];
    const isTeacherVouchee = voucheeMembership.role === MemberRole.TEACHER;

    let totalPoints = 0;
    let verified: boolean;
    let required: number;

    if (isTeacherVouchee) {
      const studentVouchCount = updatedVouches.filter(
        (v) => v.role === MemberRole.STUDENT,
      ).length;
      // vouch_points is repurposed as "qualifying vouch count" for teacher
      // vouchees — same column, different meaning depending on the
      // vouchee's role. Documented here since it's not obvious from the
      // column name alone.
      totalPoints = studentVouchCount;
      required = appConfig.TEACHER_STUDENT_VOUCHES_REQUIRED;
      verified = studentVouchCount >= required;
    } else {
      totalPoints = calculateVouchPoints(updatedVouches.map((v) => ({ role: v.role })));
      required = appConfig.VOUCH_POINTS_REQUIRED;
      verified = isVouchThresholdMet(updatedVouches.map((v) => ({ role: v.role })));
    }

    // Update the verification record
    await this.supabase
      .from('verifications')
      .update({
        vouches:      updatedVouches,
        vouch_points: totalPoints,
      })
      .eq('id', verification.id);

    this.appLogger.debug('[VERIFY:vouch] vouch count', { count: totalPoints, required });
    this.appLogger.info('[VERIFY:vouch] added', { voucherId, voucheeId, count: totalPoints });

    // If threshold met → auto-approve
    if (verified) {
      this.appLogger.info('[VERIFY:vouch] threshold reached — auto approved', { voucheeId, classroomId });
      await this.approveVerification(
        voucheeId,
        classroomId,
        VerificationMethod.PEER_VOUCH,
        req,
      );
    }

    return {
      vouchPoints: totalPoints,
      required,
      isVerified:  verified,
    };
  }

  // ── Method 3: Document Upload ─────────────────────────────────────────────

  /**
   * User submits a document for admin review.
   *
   * SECURITY:
   * - Document is uploaded to private Supabase Storage bucket
   * - Storage path is saved (never the public URL)
   * - Auto-delete scheduled at document_expires_at (30 days)
   * - Admins get signed URLs with 1-hour expiry for review
   *
   * @param storagePath - Path in private 'verification-documents' bucket
   */
  async submitDocument(
    userId: string,
    classroomId: string,
    storagePath: string,
    req?: Request,
  ): Promise<{ message: string; expiresAt: Date }> {
    this.appLogger.debug('[VERIFY:doc] entry', { userId, classroomId });
    const expiresAt = daysFromNow(appConfig.DOCUMENT_EXPIRY_DAYS);

    // Get membership ID
    const { data: membership } = await this.supabase
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .single();

    if (!membership) {
      throw new BadRequestException('You are not a member of this classroom');
    }

    await this.supabase.from('verifications').insert({
      membership_id:        membership.id,
      user_id:              userId,
      classroom_id:         classroomId,
      method:               VerificationMethod.DOCUMENT,
      status:               'pending',
      document_storage_path: storagePath,  // Path only, NOT public URL
      document_expires_at:   expiresAt.toISOString(),
    });

    // Notify classroom admins of the pending review
    this.eventEmitter.emit('verification.document.submitted', {
      userId,
      classroomId,
    });

    this.appLogger.info('[VERIFY:doc] submitted', { userId, classroomId, expiresAt });
    await this.audit.log({
      eventType:  AuditEventType.VERIFICATION_SUBMITTED,
      actorId:    userId,
      targetId:   classroomId,
      targetType: 'classroom',
      metadata: {
        method:    VerificationMethod.DOCUMENT,
        // NOTE: Do NOT log storagePath or document content here
      },
      req,
    });

    return {
      message:   'Document submitted for admin review',
      expiresAt,
    };
  }

  /**
   * Admin approves a document verification.
   * Requires MFA re-challenge (enforced in controller guard).
   *
   * SECURITY (fixes issue #3 — see module header): fetches the
   * verification's classroom first, THEN verifies `adminId` actually
   * administers THAT SPECIFIC classroom via assertClassroomAdmin() —
   * before this fix, any authenticated caller who guessed/enumerated a
   * valid verificationId could approve it regardless of which classroom
   * (or none) they administered.
   *
   * @param adminId - ID of the admin approving
   * @param verificationId - ID of the verification record
   */
  async adminApproveDocument(
    adminId: string,
    verificationId: string,
    req?: Request,
  ): Promise<void> {
    const { data: verification } = await this.supabase
      .from('verifications')
      .select('user_id, classroom_id, status, document_storage_path')
      .eq('id', verificationId)
      .single();

    if (!verification) {
      throw new NotFoundException('Verification record not found');
    }

    await this.assertClassroomAdmin(adminId, verification.classroom_id);

    if (verification.status !== 'pending') {
      throw new BadRequestException(
        `Verification is already ${verification.status}`,
      );
    }

    // Mark the verification as approved and record who reviewed it
    await this.supabase
      .from('verifications')
      .update({
        status:      'approved',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', verificationId);

    // Update membership to verified
    await this.approveVerification(
      verification.user_id,
      verification.classroom_id,
      VerificationMethod.DOCUMENT,
      req,
    );

    // Schedule document deletion (emit event — storage module handles this)
    // Document should be deleted immediately after approval per privacy design.
    // userId is also included (added when NotificationModule was built) so
    // its handler can notify the applicant without a second DB round trip —
    // this event now has two independent listeners with different needs.
    this.eventEmitter.emit('verification.document.approved', {
      storagePath: verification.document_storage_path,
      verificationId,
      userId: verification.user_id,
    });

    await this.audit.log({
      eventType:  AuditEventType.ADMIN_VERIFICATION_APPROVED,
      actorId:    adminId,
      targetId:   verificationId,
      targetType: 'verification',
      metadata: {
        user_id:      verification.user_id,
        classroom_id: verification.classroom_id,
        method:       VerificationMethod.DOCUMENT,
      },
      req,
    });
  }

  /**
   * Admin rejects a document verification with a reason.
   *
   * SECURITY (fixes issue #3 — see module header and
   * adminApproveDocument()'s comment for the full reasoning): same
   * assertClassroomAdmin() ownership check, applied before the
   * status/existence check reveals anything about the record.
   */
  async adminRejectDocument(
    adminId: string,
    verificationId: string,
    reason: string,
    req?: Request,
  ): Promise<void> {
    const { data: verification } = await this.supabase
      .from('verifications')
      .select('user_id, classroom_id, status')
      .eq('id', verificationId)
      .single();

    if (!verification) {
      throw new NotFoundException('Verification record not found');
    }

    await this.assertClassroomAdmin(adminId, verification.classroom_id);

    if (verification.status !== 'pending') {
      throw new BadRequestException('Verification not found or already processed');
    }

    await this.supabase
      .from('verifications')
      .update({
        status:           'rejected',
        reviewed_by:      adminId,
        reviewed_at:      new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', verificationId);

    // Notify the user of rejection and reason
    this.eventEmitter.emit('verification.document.rejected', {
      userId:   verification.user_id,
      classroomId: verification.classroom_id,
      reason,
    });

    this.appLogger.warn('Verification rejected', { userId: verification.user_id, classroomId: verification.classroom_id });
    await this.audit.log({
      eventType:  AuditEventType.ADMIN_VERIFICATION_REJECTED,
      actorId:    adminId,
      targetId:   verificationId,
      targetType: 'verification',
      metadata: {
        user_id:      verification.user_id,
        classroom_id: verification.classroom_id,
        reason,       // Reason is not PII — it's an admin-supplied string
      },
      req,
    });
  }

  // ── Method 4: LinkedIn Import ──────────────────────────────────────────────

  /**
   * Verifies via LinkedIn education history. Requires the caller to have
   * already connected + verified LinkedIn (profiles.linkedin_verified —
   * that OAuth handshake itself is out of this module's scope; it's a
   * prerequisite this method checks, not one it performs). Auto-approves
   * on a match between the classroom's institution and the caller's
   * LinkedIn education entries.
   *
   * ASSUMPTION: profiles.linkedin_education's shape isn't specified
   * anywhere in SPEC.md — it's typed `jsonb` with no documented schema.
   * This assumes an array of entries shaped like
   * `{ schoolName: string, startYear?: number, endYear?: number }`, which
   * is the conventional shape LinkedIn's own education data takes. A
   * match requires the school name to correspond to this classroom's
   * institution AND the start or end year to equal the classroom's
   * batch_year.
   */
  async verifyViaLinkedin(
    userId: string,
    classroomId: string,
    req?: Request,
  ): Promise<{ verified: boolean }> {
    this.appLogger.debug('[VERIFY:linkedin] entry', { userId, classroomId });

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('linkedin_verified, linkedin_education')
      .eq('id', userId)
      .single();

    if (!profile?.linkedin_verified) {
      throw new BadRequestException(
        'Connect and verify LinkedIn before using it to verify your classroom membership',
      );
    }

    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('batch_year, institution:institutions(name, slug)')
      .eq('id', classroomId)
      .single();

    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const institution = classroom.institution as any;
    const institutionName = (institution?.name ?? '').toLowerCase();
    const institutionSlug = (institution?.slug ?? '').toLowerCase();

    const educationEntries: Array<{ schoolName?: string; startYear?: number; endYear?: number }> =
      Array.isArray(profile.linkedin_education) ? profile.linkedin_education : [];

    const match = educationEntries.some((entry) => {
      const schoolName = (entry.schoolName ?? '').toLowerCase();
      const nameMatches =
        (!!schoolName && schoolName === institutionName) ||
        (!!institutionSlug && schoolName.includes(institutionSlug));
      const yearMatches =
        entry.endYear === classroom.batch_year || entry.startYear === classroom.batch_year;
      return nameMatches && yearMatches;
    });

    this.appLogger.debug('[VERIFY:linkedin] match result', { userId, classroomId, matched: match });

    if (!match) {
      this.appLogger.warn('[VERIFY:linkedin] no match', { userId, classroomId });
      throw new BadRequestException(
        'No matching institution and graduation year found in your LinkedIn education history',
      );
    }

    // Auto-approve — approveVerification() writes the VERIFICATION_APPROVED
    // audit entry; there is no separate "submitted" phase to log here since
    // the match check and the approval happen in the same request, the
    // same pattern addVouch() already follows for its auto-approve path.
    await this.approveVerification(userId, classroomId, VerificationMethod.LINKEDIN, req);

    this.appLogger.info('[VERIFY:linkedin] verified', { userId, classroomId });
    return { verified: true };
  }

  // ── Method 5 & 6: Institution Codes ───────────────────────────────────────

  /**
   * Redeems a personal or batch institution code.
   *
   * Validates:
   * - Code format is correct
   * - Code exists and belongs to this classroom
   * - Code is not expired
   * - For personal codes: not already redeemed (check-then-update — safe,
   *   since a personal code is tied to one specific person; there is no
   *   meaningful concurrent-redemption race to close)
   * - For batch codes: redeemed via the redeem_batch_code() SQL RPC
   *   (SECURITY — fixes issue #2, see module header). The check-then-update
   *   pattern this replaced was a real race: two concurrent requests could
   *   both read redemption_count < max_redemptions before either write
   *   landed, over-redeeming the code past its cap. The RPC holds a row
   *   lock for the whole check-and-increment instead.
   */
  async redeemCode(
    userId: string,
    classroomId: string,
    code: string,
    req?: Request,
  ): Promise<{ verified: boolean }> {
    this.appLogger.debug('[VERIFY:code] entry', { userId, classroomId, codePrefix: code?.slice(0, 4) });

    // Validate code format before hitting DB
    if (!isValidInstitutionCode(code)) {
      throw new BadRequestException({
        message: 'Invalid code format',
        error: ErrorCode.VERIFICATION_CODE_INVALID,
      });
    }

    const { data: codeRecord } = await this.supabase
      .from('institution_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!codeRecord) {
      this.appLogger.warn('[VERIFY:code] invalid code', { userId, classroomId });
      throw new BadRequestException({
        message: 'Invalid code or code not valid for this classroom',
        error: ErrorCode.VERIFICATION_CODE_INVALID,
      });
    }

    // Friendly pre-check — the RPC re-validates expiry itself for the
    // batch path (authoritatively, under its row lock), but personal codes
    // don't go through the RPC at all, so this is the only expiry guard
    // they get.
    if (isExpired(codeRecord.expires_at)) {
      throw new BadRequestException({
        message: 'This code has expired',
        error: ErrorCode.VERIFICATION_CODE_EXPIRED,
      });
    }

    if (codeRecord.type === 'personal') {
      if (codeRecord.is_redeemed) {
        throw new BadRequestException({
          message: 'This code has already been redeemed',
          error: ErrorCode.VERIFICATION_CODE_REDEEMED,
        });
      }

      const { error: updateError } = await this.supabase
        .from('institution_codes')
        .update({
          is_redeemed:      true,
          redeemed_by:      userId,
          redeemed_at:      new Date().toISOString(),
          redemption_count: 1,
        })
        .eq('id', codeRecord.id);

      if (updateError) {
        this.appLogger.error('[VERIFY:code] failed', {
          classroomId,
          error: updateError.message,
          code: updateError.code,
          hint: updateError.hint,
          details: updateError.details,
        });
        throw new BadRequestException('Failed to redeem this code. Please try again.');
      }
    } else {
      const { data: redeemed, error: rpcError } = await this.supabase.rpc('redeem_batch_code', {
        p_code:         code.toUpperCase(),
        p_classroom_id: classroomId,
        p_user_id:      userId,
      });

      if (rpcError) {
        this.appLogger.error('[VERIFY:code] failed', {
          classroomId,
          error: rpcError.message,
          code: rpcError.code,
          hint: rpcError.hint,
          details: rpcError.details,
        });
        throw new BadRequestException('Failed to redeem this code. Please try again.');
      }

      // The function returns NULL (not an error) when the code was already
      // fully redeemed, expired, or not found under lock — i.e. it lost a
      // race, or the pre-check above was stale by the time the RPC ran.
      if (!redeemed) {
        this.appLogger.warn('[VERIFY:code] invalid code', { userId, classroomId, reason: 'redeemed_or_expired' });
        throw new BadRequestException({
          message: 'This code has expired or reached its maximum redemption limit',
          error: ErrorCode.VERIFICATION_CODE_REDEEMED,
        });
      }
    }

    const method =
      codeRecord.type === 'personal'
        ? VerificationMethod.PERSONAL_CODE
        : VerificationMethod.BATCH_CODE;

    await this.approveVerification(userId, classroomId, method, req);

    await this.audit.log({
      eventType:  AuditEventType.CODE_REDEEMED,
      actorId:    userId,
      targetId:   codeRecord.id,
      targetType: 'code',
      metadata: {
        code_type:    codeRecord.type,
        classroom_id: classroomId,
        institution_id: codeRecord.institution_id,
        // NOTE: Do NOT log the code value itself
      },
      req,
    });

    this.appLogger.info('[VERIFY:code] verified', { userId, classroomId });
    return { verified: true };
  }

  // ── Verification status ──────────────────────────────────────────────────

  /**
   * Verification status for one membership, including the most recent
   * verification attempt's detail (method, status, timestamps, rejection
   * reason if any). SPEC.md §8.4: "Multiple attempts with different
   * methods are allowed — only one needs to succeed", so this surfaces the
   * latest attempt rather than assuming there's exactly one.
   *
   * Distinct from MembershipService.getVerificationStatus() (identity/
   * membership module), which only reads the bare
   * memberships.verification_status field — this reads the richer
   * `verifications` table this module owns, which membership.module.ts
   * deliberately does not touch.
   *
   * SECURITY: this can return a rejection_reason, which may contain
   * sensitive review notes — not something to leave world-readable behind
   * a guessable UUID. `requesterId` must be either the membership's own
   * user, or a verified admin of that classroom. This exact gap (an
   * endpoint that took an id with no ownership check) is what issue #3
   * was about elsewhere in this module; applying the same standard here
   * even though the task didn't separately call this endpoint out.
   */
  async getStatusByMembership(requesterId: string, membershipId: string) {
    const { data: membership } = await this.supabase
      .from('memberships')
      .select('id, user_id, classroom_id, role, verification_status, verification_method, verified_at')
      .eq('id', membershipId)
      .maybeSingle();

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    if (membership.user_id !== requesterId) {
      await this.assertClassroomAdmin(requesterId, membership.classroom_id);
    }

    const { data: latestAttempt } = await this.supabase
      .from('verifications')
      .select('method, status, vouch_points, reviewed_at, rejection_reason, created_at')
      .eq('membership_id', membershipId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      membershipId,
      verificationStatus: membership.verification_status,
      verificationMethod: membership.verification_method,
      verifiedAt:          membership.verified_at,
      latestAttempt:       latestAttempt ?? null,
    };
  }

  // ── Internal: Approve Verification ───────────────────────────────────────

  /**
   * Internal method — sets membership to verified and fires notifications.
   * Called by all verification methods on success.
   *
   * NOT exposed as an API endpoint — only called internally.
   */
  private async approveVerification(
    userId: string,
    classroomId: string,
    method: VerificationMethod,
    req?: Request,
  ): Promise<void> {
    // Update membership to verified
    const { error } = await this.supabase
      .from('memberships')
      .update({
        verification_status: 'verified',
        verification_method: method,
        verified_at:         new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('classroom_id', classroomId);

    if (error) {
      this.logger.error('Failed to update membership to verified', {
        error,
        userId,
        classroomId,
        method,
      });
      throw new Error('Failed to verify membership');
    }

    // Fire notification event — notification module sends push + in-app
    this.eventEmitter.emit('verification.approved', {
      userId,
      classroomId,
      method,
    });

    this.appLogger.info('Verified', { userId, classroomId, method });
    await this.audit.log({
      eventType:  AuditEventType.VERIFICATION_APPROVED,
      actorId:    userId,
      targetId:   classroomId,
      targetType: 'membership',
      metadata: { method, classroom_id: classroomId },
      req,
    });
  }

  // ── Internal: Admin ownership check ──────────────────────────────────────

  /**
   * SECURITY (fixes issue #3 — see module header). Throws unless `adminId`
   * holds a verified 'admin' membership in `classroomId` specifically, OR
   * (see UPDATE below) is an active school_admin for that classroom's
   * institution. Being an admin of some OTHER classroom is still not
   * sufficient either way — this remains scoped per classroom/institution,
   * matching the same check ClassroomService.updateClassroom() applies to
   * its own admin-only action.
   *
   * UPDATE — authorization gap fix (found wiring up the admin module):
   * this originally rejected a school_admin persona outright ("even a
   * school_admin persona at the institution, is not sufficient"), on the
   * reasoning that classroom-level review authority is distinct from
   * institution-level admin status. That turned out to be wrong per
   * SPEC.md §7.2, which grants a school admin access to "all classrooms in
   * their institution" — but the database never auto-creates a classroom-
   * level admin membership row for them (only classroom CREATORS get
   * that), so a legitimate school admin who'd never personally joined the
   * classroom got ForbiddenException here, including via AdminModule's
   * delegated approve/reject calls. Fixed by checking classroom membership
   * FIRST (unchanged — a classroom admin's access is untouched) and, only
   * if that fails, falling back to a verified/active school_admin persona
   * for the classroom's own institution.
   */
  private async assertClassroomAdmin(adminId: string, classroomId: string): Promise<void> {
    const { data: classroomMembership } = await this.supabase
      .from('memberships')
      .select('id, role, is_creator')
      .eq('user_id', adminId)
      .eq('classroom_id', classroomId)
      .eq('verification_status', 'verified')
      .maybeSingle();

    if (classroomMembership && (classroomMembership.role === 'admin' || classroomMembership.is_creator)) {
      return;
    }

    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('institution_id')
      .eq('id', classroomId)
      .maybeSingle();

    if (classroom) {
      const { data: schoolAdminPersona } = await this.supabase
        .from('personas')
        .select('id')
        .eq('user_id', adminId)
        .eq('institution_id', classroom.institution_id)
        .eq('type', PersonaType.SCHOOL_ADMIN)
        .eq('status', 'active')
        .maybeSingle();

      if (schoolAdminPersona) {
        return;
      }
    }

    throw new ForbiddenException(
      'Only a verified admin of this classroom, or an active school admin of its institution, can review verification requests',
    );
  }

  // ── Internal: OTP helpers ────────────────────────────────────────────────
  //
  // Deliberately NOT in @alumini/utils: that package is imported by the
  // web and mobile apps too (per its own header comment), and Node's
  // `crypto` module isn't safe to bundle into a browser/React Native build.
  // AuthService has the identical pair of private helpers for the exact
  // same reason (SMS OTPs there, email OTPs here) — this is the second
  // module solving the same narrow problem, not a missed opportunity to
  // share code across a runtime boundary that can't actually share it.

  /** One-way hash for OTP codes — never store or compare the raw code. */
  private hashOtp(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private generateNumericCode(length: number): string {
    const max = 10 ** length;
    return randomInt(0, max).toString().padStart(length, '0');
  }
}
