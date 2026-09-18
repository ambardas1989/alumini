/**
 * AdminService — the school admin portal (SPEC.md §11) plus platform-admin
 * institution-claim review.
 *
 * AGGREGATION APPROACH — read this before adding a method:
 * This module does NOT import ClassroomService, VerificationService's
 * listing logic, CodesService, or InstitutionService's listing logic to
 * build its dashboard/analytics views. Every GET endpoint below queries
 * classrooms / memberships / verifications / institution_codes / personas
 * directly with this service's own Supabase client — the exact same
 * cross-module direct-table-access pattern every module since auth has
 * used, just applied across MORE tables at once because a dashboard is
 * inherently cross-cutting. The task is explicit about this: "It
 * aggregates data from institution, classroom, verification, and codes
 * modules via Supabase queries — it does not import those modules
 * directly." Two consequences worth knowing:
 *   1. countActiveCodes() below duplicates ~5 lines of status logic that
 *      also lives in CodesService.computeStatus() — deliberate, not an
 *      oversight, per the instruction above.
 *   2. Counts here are point-in-time reads, not cached/materialized — at
 *      real scale, SPEC.md §15.5 (10k+ users) would reach for read
 *      replicas or a materialized view before this module needs to change.
 *
 * THE FOUR EXCEPTIONS — document/claim approve+reject genuinely DO inject
 * VerificationService and InstitutionService and delegate to their
 * existing methods (adminApproveDocument/adminRejectDocument/approveClaim/
 * rejectClaim), per the task's explicit "Delegates to X()" wording for
 * those four operations specifically. This is intentional and different
 * from the read-side aggregation above: those methods carry real,
 * already-audited, already-tested business logic (status transitions, RPC
 * calls, their own audit entries) that would be actively harmful to
 * reimplement a second time with a chance to drift out of sync.
 *
 * ✔ FIXED — school-admin-without-classroom-membership gap: earlier
 * versions of this module called VerificationService.adminApproveDocument()/
 * adminRejectDocument() after only checking assertSchoolAdmin(institutionId)
 * (an ACTIVE school_admin PERSONA) — but those VerificationService methods
 * authorize via assertClassroomAdmin(), which checks a VERIFIED CLASSROOM-
 * LEVEL 'admin' MEMBERSHIP ROLE, a different concept the database never
 * auto-creates for a school admin (only classroom CREATORS get that
 * membership row). SPEC.md §7.2 says a school admin can act on "all
 * classrooms in their institution" regardless, so this was a real bug: a
 * legitimate school admin who'd never personally joined the specific
 * classroom would get ForbiddenException from the delegated call. Fixed
 * two ways, together:
 *   1. assertInstitutionAdminCanAccessClassroom() below — this module's
 *      OWN pre-check, run before every delegated call. Confirms the actor
 *      is an active school_admin of institutionId AND that the classroom
 *      in question actually belongs to that institution. It does NOT look
 *      at memberships at all, on purpose — a school admin doesn't need to
 *      have joined the classroom.
 *   2. VerificationService.assertClassroomAdmin() (verification.service.ts)
 *      now ALSO accepts a verified, active school_admin persona for the
 *      classroom's institution, as a fallback checked only when the
 *      classroom-membership check fails — additive, so a classroom-level
 *      admin's existing access is completely unchanged, and this also
 *      fixes the identical gap for a school admin calling
 *      /verify/document/:id/approve directly (not just through this
 *      module), since that endpoint delegates to the exact same method.
 *   Both layers matter: (1) alone would let this module's own check pass
 *   while the delegated call still throws; (2) alone would leave this
 *   module unable to give a clean, admin-module-specific error (or to
 *   reject a verificationId/institutionId mismatch) before ever calling
 *   VerificationService.
 *
 * TWO-LAYER AUTHORIZATION for the four delegated methods, generally: this
 * module always confirms BOTH that the actor is a school admin of
 * institutionId AND that the specific verification/claim actually belongs
 * to that institution BEFORE delegating — the institutionId in the URL is
 * otherwise never seen by VerificationService.adminApproveDocument(),
 * which only knows about the classroom, not the institution. Without this
 * check, a school admin of Institution A could approve a document at
 * Institution B simply by guessing/enumerating a verificationId.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { VerificationService } from '../verification/verification.service';
import { InstitutionService } from '../institution/institution.service';
import { AuditEventType, PersonaType } from '@alumini/types';
import { isExpired } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';

import { RejectVerificationDocumentDto } from './dto/reject-verification-document.dto';
import { RejectInstitutionClaimDto } from './dto/reject-institution-claim.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly audit: AuditService,
    private readonly verificationService: VerificationService,
    private readonly institutionService: InstitutionService,
  ) {
    // Service role — bypasses RLS, same pattern as every other module.
    // Also used for Supabase Storage signed URLs (getVerificationDocumentUrl()).
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Dashboard overview ────────────────────────────────────────────────────

  async getOverview(userId: string, institutionId: string) {
    await this.assertSchoolAdmin(userId, institutionId);

    const classroomIds = await this.getInstitutionClassroomIds(institutionId);

    const [totalClassroomsResult, totalAdminsResult] = await Promise.all([
      this.supabase.from('classrooms').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId),
      this.supabase
        .from('personas')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId)
        .eq('type', PersonaType.SCHOOL_ADMIN)
        .eq('status', 'active'),
    ]);

    let totalVerifiedMembers = 0;
    let pendingVerifications = 0;

    if (classroomIds.length > 0) {
      const [verifiedResult, pendingResult] = await Promise.all([
        this.supabase
          .from('memberships')
          .select('id', { count: 'exact', head: true })
          .in('classroom_id', classroomIds)
          .eq('verification_status', 'verified'),
        this.supabase
          .from('verifications')
          .select('id', { count: 'exact', head: true })
          .in('classroom_id', classroomIds)
          .eq('status', 'pending'),
      ]);
      totalVerifiedMembers = verifiedResult.count ?? 0;
      pendingVerifications = pendingResult.count ?? 0;
    }

    return {
      totalClassrooms:    totalClassroomsResult.count ?? 0,
      totalVerifiedMembers,
      pendingVerifications,
      activeCodes:        await this.countActiveCodes(institutionId),
      totalAdmins:        totalAdminsResult.count ?? 0,
    };
  }

  // ── Classrooms view ──────────────────────────────────────────────────────

  /**
   * All classrooms grouped by batch year, descending, each annotated with
   * member/verified/pending counts. `canAddClassroom` is this method's
   * reading of "+ add button data (just return the data — UI handles
   * rendering)" — a school admin can always add a classroom to their own
   * institution, so it's always true here; the field exists so the
   * frontend doesn't need to hardcode that assumption itself.
   */
  async getClassroomsByYear(userId: string, institutionId: string) {
    await this.assertSchoolAdmin(userId, institutionId);

    const { data: classrooms, error } = await this.supabase
      .from('classrooms')
      .select('id, global_id, name, batch_year, grade, section, program, member_count')
      .eq('institution_id', institutionId)
      .order('batch_year', { ascending: false });

    if (error) {
      this.logger.error('Failed to load classrooms', { error, institutionId });
      throw new BadRequestException('Failed to load classrooms');
    }

    const classroomIds = (classrooms ?? []).map((c) => c.id);
    const verifiedCounts: Record<string, number> = {};
    const pendingCounts: Record<string, number> = {};

    if (classroomIds.length > 0) {
      const { data: memberships } = await this.supabase
        .from('memberships')
        .select('classroom_id, verification_status')
        .in('classroom_id', classroomIds);

      for (const m of memberships ?? []) {
        if (m.verification_status === 'verified') {
          verifiedCounts[m.classroom_id] = (verifiedCounts[m.classroom_id] ?? 0) + 1;
        } else if (m.verification_status === 'pending') {
          pendingCounts[m.classroom_id] = (pendingCounts[m.classroom_id] ?? 0) + 1;
        }
      }
    }

    const byYear = new Map<number, any[]>();
    for (const c of classrooms ?? []) {
      const entry = {
        id:            c.id,
        globalId:      c.global_id,
        name:          c.name,
        grade:         c.grade,
        section:       c.section,
        program:       c.program,
        memberCount:   c.member_count,
        verifiedCount: verifiedCounts[c.id] ?? 0,
        pendingCount:  pendingCounts[c.id] ?? 0,
      };
      const bucket = byYear.get(c.batch_year) ?? [];
      bucket.push(entry);
      byYear.set(c.batch_year, bucket);
    }

    return Array.from(byYear.keys())
      .sort((a, b) => b - a) // years descending
      .map((year) => ({ year, classrooms: byYear.get(year), canAddClassroom: true }));
  }

  // ── Verification queue ───────────────────────────────────────────────────

  /**
   * All pending DOCUMENT verifications across the institution's
   * classrooms. document_storage_path is deliberately never selected —
   * task requirement, matching VerificationService's own "document
   * storage paths are NEVER returned to clients" rule (see its module
   * comment). Use getVerificationDocumentUrl() for a time-limited signed
   * URL instead.
   */
  async getPendingDocumentVerifications(userId: string, institutionId: string) {
    await this.assertSchoolAdmin(userId, institutionId);

    const { data: classroomRows } = await this.supabase
      .from('classrooms')
      .select('id, name')
      .eq('institution_id', institutionId);

    const classroomNameById = new Map((classroomRows ?? []).map((c) => [c.id, c.name]));
    const classroomIds = Array.from(classroomNameById.keys());

    if (classroomIds.length === 0) {
      return [];
    }

    const { data: verifications, error } = await this.supabase
      .from('verifications')
      .select('id, user_id, classroom_id, created_at, profile:profiles(full_name)')
      .eq('method', 'document')
      .eq('status', 'pending')
      .in('classroom_id', classroomIds)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to load pending verifications', { error, institutionId });
      throw new BadRequestException('Failed to load pending verifications');
    }

    return (verifications ?? []).map((v: any) => ({
      verificationId:  v.id,
      userId:          v.user_id,
      userDisplayName: v.profile?.full_name ?? 'Unknown',
      classroomId:     v.classroom_id,
      classroomName:   classroomNameById.get(v.classroom_id) ?? 'Unknown',
      submittedAt:     v.created_at,
    }));
  }

  /**
   * Signed URL for one document (SPEC.md §18.3 — 1hr expiry,
   * appConfig.DOCUMENT_SIGNED_URL_EXPIRY_SECONDS). Every access is
   * audited (task requirement) — this is the one place in the whole
   * codebase a verification document's actual content becomes reachable,
   * so every read of it needs a paper trail independent of whether
   * anything was approved/rejected afterward.
   */
  async getVerificationDocumentUrl(
    userId: string,
    institutionId: string,
    verificationId: string,
    req?: Request,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const verification = await this.getVerificationRecord(verificationId);
    await this.assertInstitutionAdminCanAccessClassroom(userId, institutionId, verification.classroomId);

    if (!verification.documentStoragePath) {
      throw new NotFoundException('This verification has no document on file');
    }

    const { data: signed, error } = await this.supabase.storage
      .from('verification-documents')
      .createSignedUrl(verification.documentStoragePath, appConfig.DOCUMENT_SIGNED_URL_EXPIRY_SECONDS);

    if (error || !signed) {
      this.logger.error('Failed to generate signed document URL', { error, verificationId });
      throw new BadRequestException('Failed to generate a document link. Please try again.');
    }

    await this.audit.log({
      eventType:  AuditEventType.ADMIN_VERIFICATION_DOCUMENT_ACCESSED,
      actorId:    userId,
      targetId:   verificationId,
      targetType: 'verification',
      metadata:   { institution_id: institutionId },
      req,
    });

    return { url: signed.signedUrl, expiresInSeconds: appConfig.DOCUMENT_SIGNED_URL_EXPIRY_SECONDS };
  }

  /**
   * Delegates to VerificationService.adminApproveDocument() — see the
   * module-level comment for the two-part authorization fix this relies on.
   */
  async approveVerificationDocument(
    userId: string,
    institutionId: string,
    verificationId: string,
    req?: Request,
  ): Promise<void> {
    const verification = await this.getVerificationRecord(verificationId);
    await this.assertInstitutionAdminCanAccessClassroom(userId, institutionId, verification.classroomId);

    await this.verificationService.adminApproveDocument(userId, verificationId, req);
  }

  /** Delegates to VerificationService.adminRejectDocument() — same reasoning as approveVerificationDocument(). */
  async rejectVerificationDocument(
    userId: string,
    institutionId: string,
    verificationId: string,
    dto: RejectVerificationDocumentDto,
    req?: Request,
  ): Promise<void> {
    const verification = await this.getVerificationRecord(verificationId);
    await this.assertInstitutionAdminCanAccessClassroom(userId, institutionId, verification.classroomId);

    await this.verificationService.adminRejectDocument(userId, verificationId, dto.reason, req);
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  async getAnalytics(userId: string, institutionId: string) {
    await this.assertSchoolAdmin(userId, institutionId);

    const { data: classrooms, error } = await this.supabase
      .from('classrooms')
      .select('id, name, member_count')
      .eq('institution_id', institutionId);

    if (error) {
      this.logger.error('Failed to load classrooms for analytics', { error, institutionId });
      throw new BadRequestException('Failed to load analytics');
    }

    const topClassrooms = [...(classrooms ?? [])]
      .sort((a, b) => b.member_count - a.member_count)
      .slice(0, 5)
      .map((c) => ({ classroomId: c.id, name: c.name, memberCount: c.member_count }));

    const classroomIds = (classrooms ?? []).map((c) => c.id);

    let activeAlumniCount = 0;
    const verificationMethodBreakdown: Record<string, number> = {};
    let newMembersThisMonth = 0;

    if (classroomIds.length > 0) {
      const { count: verifiedCount } = await this.supabase
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .in('classroom_id', classroomIds)
        .eq('verification_status', 'verified');
      activeAlumniCount = verifiedCount ?? 0;

      const { data: methodRows } = await this.supabase
        .from('memberships')
        .select('verification_method')
        .in('classroom_id', classroomIds)
        .eq('verification_status', 'verified');

      for (const m of methodRows ?? []) {
        const key = m.verification_method ?? 'unknown';
        verificationMethodBreakdown[key] = (verificationMethodBreakdown[key] ?? 0) + 1;
      }

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count: newCount } = await this.supabase
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .in('classroom_id', classroomIds)
        .gte('joined_at', startOfMonth.toISOString());
      newMembersThisMonth = newCount ?? 0;
    }

    return { activeAlumniCount, topClassrooms, verificationMethodBreakdown, newMembersThisMonth };
  }

  // ── Institution claims (platform admin only) ─────────────────────────────

  /**
   * SPEC.md §11.1's claim queue. A "claim" IS the pending_approval
   * school_admin persona InstitutionService.submitClaim() created — there
   * is no separate claims table (see institution.service.ts's own module
   * comment) — so claimId in this module's routes is that persona's id.
   */
  async listPendingClaims(userId: string) {
    await this.assertPlatformAdmin(userId);

    const { data, error } = await this.supabase
      .from('personas')
      .select('id, user_id, institution_id, created_at, profile:profiles(full_name, email), institution:institutions(name, slug)')
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to load pending institution claims', { error });
      throw new BadRequestException('Failed to load pending claims');
    }

    return (data ?? []).map((c: any) => ({
      claimId:          c.id,
      userId:           c.user_id,
      userDisplayName:  c.profile?.full_name ?? 'Unknown',
      userEmail:        c.profile?.email,
      institutionId:    c.institution_id,
      institutionName:  c.institution?.name ?? 'Unknown',
      submittedAt:      c.created_at,
    }));
  }

  /** Delegates to InstitutionService.approveClaim() — platform-admin gated, per SPEC.md §3.4. */
  async approveClaim(userId: string, claimId: string, req?: Request) {
    await this.assertPlatformAdmin(userId);
    return this.institutionService.approveClaim(userId, claimId, req);
  }

  /** Delegates to InstitutionService.rejectClaim() — same gating as approveClaim(). */
  async rejectClaim(userId: string, claimId: string, dto: RejectInstitutionClaimDto, req?: Request) {
    await this.assertPlatformAdmin(userId);
    return this.institutionService.rejectClaim(userId, claimId, { reason: dto.reason }, req);
  }

  // ── Internal: access control ─────────────────────────────────────────────

  private async assertSchoolAdmin(userId: string, institutionId: string): Promise<void> {
    const { data } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', userId)
      .eq('institution_id', institutionId)
      .eq('type', PersonaType.SCHOOL_ADMIN)
      .eq('status', 'active')
      .maybeSingle();

    if (!data) {
      throw new ForbiddenException('Only an active school admin of this institution can perform this action');
    }
  }

  /**
   * FIX (see module-level comment's "✔ FIXED" note): the pre-check for
   * every document-review delegation. Confirms the actor is an active
   * school_admin of `institutionId` AND that `classroomId` actually
   * belongs to that institution — and deliberately does NOT look at
   * `memberships` at all. SPEC.md §7.2 grants a school admin access to
   * every classroom in their institution regardless of whether they
   * personally joined it, so requiring a membership row here would
   * reintroduce the exact bug this method exists to fix. If both checks
   * pass, the caller may proceed regardless of any classroom membership row.
   */
  private async assertInstitutionAdminCanAccessClassroom(
    adminId: string,
    institutionId: string,
    classroomId: string,
  ): Promise<void> {
    await this.assertSchoolAdmin(adminId, institutionId);

    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('id')
      .eq('id', classroomId)
      .eq('institution_id', institutionId)
      .maybeSingle();

    if (!classroom) {
      throw new NotFoundException('This classroom does not belong to your institution');
    }
  }

  private async assertPlatformAdmin(userId: string): Promise<void> {
    const { data } = await this.supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .maybeSingle();

    if (!data?.is_platform_admin) {
      throw new ForbiddenException('Platform admin access required');
    }
  }

  // ── Internal: lookups ────────────────────────────────────────────────────

  private async getInstitutionClassroomIds(institutionId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('classrooms')
      .select('id')
      .eq('institution_id', institutionId);

    if (error) {
      this.logger.error('Failed to load institution classrooms', { error, institutionId });
      return [];
    }

    return (data ?? []).map((c) => c.id);
  }

  /**
   * Plain fetch, no authorization — pairs with
   * assertInstitutionAdminCanAccessClassroom(), which needs classroomId
   * before it can check anything. Split from that check (unlike the old
   * getVerificationInInstitution() this replaced) so a missing verification
   * and a wrong-institution classroom get distinctly clear errors.
   */
  private async getVerificationRecord(
    verificationId: string,
  ): Promise<{ id: string; classroomId: string; documentStoragePath: string | null }> {
    const { data } = await this.supabase
      .from('verifications')
      .select('id, classroom_id, document_storage_path')
      .eq('id', verificationId)
      .maybeSingle();

    if (!data) {
      throw new NotFoundException('Verification not found');
    }

    return { id: data.id, classroomId: data.classroom_id, documentStoragePath: data.document_storage_path };
  }

  /**
   * Mirrors CodesService.computeStatus()'s status logic to decide whether
   * a code counts as "active" for the overview count — deliberately
   * duplicated rather than importing CodesModule, per this module's
   * "aggregate via queries, don't import" rule (see module-level comment).
   */
  private async countActiveCodes(institutionId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('institution_codes')
      .select('type, is_redeemed, redemption_count, max_redemptions, expires_at')
      .eq('institution_id', institutionId);

    if (error) {
      this.logger.error('Failed to count active codes', { error, institutionId });
      return 0;
    }

    return (data ?? []).filter((c) => {
      if (isExpired(c.expires_at)) return false;
      if (c.type === 'personal' && c.is_redeemed) return false;
      if (c.type === 'batch' && c.max_redemptions !== null && c.redemption_count >= c.max_redemptions) return false;
      return true;
    }).length;
  }
}
