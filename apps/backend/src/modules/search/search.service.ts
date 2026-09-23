/**
 * SearchService — teacher cross-classroom student search (SPEC.md §12.2).
 *
 * SCOPE: institution search (GET /institutions?q=&countryCode=) already
 * lives in InstitutionModule (apps/backend/src/modules/institution) — it
 * moved there from an even earlier classroom-module scaffold, and is not
 * duplicated here. This module owns exactly one thing: a verified
 * teacher's ability to search for students across every classroom they
 * teach in.
 *
 * ACCESS: every method requires an ACTIVE teacher persona (assertTeacher()
 * — any institution, this is a general "are they a teacher at all" gate)
 * AND scopes results to classrooms where that teacher's own MEMBERSHIP is
 * verified (getVerifiedTeacherClassroomIds()) — these are two different
 * checks against two different tables (personas vs memberships) for two
 * different reasons: the persona proves "this account represents a
 * teacher"; the verified membership proves "and specifically verified in
 * THIS classroom", which is what actually gates seeing its roster.
 *
 * FUZZY NAME MATCH: uses a real PostgreSQL ILIKE via supabase-js's
 * .ilike(), not an in-application substring filter — the task is explicit
 * about this. The query starts FROM `profiles` (ilike on its own
 * full_name column, which supabase-js supports directly) and inner-joins
 * `memberships` (PostgREST's `!inner` embed, which is what makes
 * dot-notation filters like `.eq('memberships.role', 'student')` and
 * `.in('memberships.classroom_id', ids)` valid against the embedded
 * table) rather than starting from `memberships` and trying to filter by
 * a joined profiles column, which supabase-js's top-level `.ilike()`
 * cannot target.
 *
 * ASSUMPTION: "current role (if opted into 'Where Are They Now')" from
 * SPEC.md §12.2 refers to the Premium feature (SPEC.md §13, not built in
 * this codebase yet) — this module surfaces each result's classroom role
 * (student/teacher/admin) and verification status, not a self-reported
 * "current job" field, since profiles has no such column yet.
 */

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PersonaType } from '@alumini/types';
import { appConfig } from '@alumini/config/app';
import { AppLogger } from '../../common/logger/logger.service';

import { SearchStudentsDto } from './dto/search-students.dto';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(appLogger: AppLogger) {
    this.appLogger = appLogger.setContext('SEARCH');
    // Service role — bypasses RLS, same pattern as every other module.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /**
   * Name search across every classroom the caller is a verified teacher
   * in (or one specific classroom, if classroomId narrows it). Each
   * matching (student, classroom) pair is its own result row — a student
   * in three of the teacher's classrooms produces three rows, matching
   * "Results show: name, classroom name, batch year..." (per-classroom
   * detail, not one row per person).
   */
  async searchStudents(teacherId: string, dto: SearchStudentsDto) {
    this.appLogger.debug('[SEARCH:students] entry', { query: dto.q, userId: teacherId, filters: { classroomId: dto.classroomId } });
    await this.assertTeacher(teacherId);

    const verifiedClassroomIds = await this.getVerifiedTeacherClassroomIds(teacherId);
    if (verifiedClassroomIds.length === 0) {
      return [];
    }

    let targetClassroomIds = verifiedClassroomIds;
    if (dto.classroomId) {
      if (!verifiedClassroomIds.includes(dto.classroomId)) {
        throw new ForbiddenException('You are not a verified teacher in this classroom');
      }
      targetClassroomIds = [dto.classroomId];
    }

    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, full_name, avatar_url, memberships:memberships!inner(classroom_id, role, verification_status, classroom:classrooms(id, name, batch_year))')
      .ilike('full_name', `%${dto.q}%`)
      .eq('memberships.role', 'student')
      .in('memberships.classroom_id', targetClassroomIds)
      .limit(appConfig.MEMBERS_PAGE_SIZE);

    this.appLogger.debug('[SEARCH:students] result', { count: data?.length, error: error?.message });

    if (error) {
      this.appLogger.error('[SEARCH:students] failed', {
        teacherId,
        q: dto.q,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to search students');
    }

    const results: Array<{
      userId: string;
      fullName: string;
      avatarUrl: string | null;
      classroomId: string;
      classroomName: string | undefined;
      batchYear: number | undefined;
      verificationStatus: string;
      role: string;
    }> = [];

    for (const profile of data ?? []) {
      for (const m of (profile as any).memberships ?? []) {
        results.push({
          userId:             profile.id,
          fullName:           profile.full_name,
          avatarUrl:          profile.avatar_url,
          classroomId:        m.classroom_id,
          classroomName:      m.classroom?.name,
          batchYear:          m.classroom?.batch_year,
          verificationStatus: m.verification_status,
          role:               m.role,
        });
      }
    }

    return results;
  }

  // ── Student profile (recommendation context) ─────────────────────────────

  /**
   * Profile + every classroom the caller (verified teacher) and this
   * student share — SPEC.md §12.2's "Recommend button (opens
   * recommendation letter template)" needs this shared history as
   * context. Deliberately not filtered to role='student' — "all shared
   * classrooms between teacher and student" (task wording) doesn't say
   * "only where they're a student", and someone found via student search
   * could be a teacher elsewhere.
   */
  async getStudentProfile(teacherId: string, studentUserId: string) {
    await this.assertTeacher(teacherId);

    const verifiedClassroomIds = await this.getVerifiedTeacherClassroomIds(teacherId);
    if (verifiedClassroomIds.length === 0) {
      throw new ForbiddenException('You are not verified in any classroom yet');
    }

    const { data: sharedMemberships, error } = await this.supabase
      .from('memberships')
      .select('classroom_id, role, verification_status, joined_at, classroom:classrooms(id, name, batch_year, global_id)')
      .eq('user_id', studentUserId)
      .in('classroom_id', verifiedClassroomIds);

    if (error) {
      this.logger.error('Failed to load shared classrooms', { error, teacherId, studentUserId });
      throw new BadRequestException('Failed to load student profile');
    }

    if (!sharedMemberships || sharedMemberships.length === 0) {
      // Deliberately the same "not found" whether studentUserId doesn't
      // exist at all or simply shares no classroom with this teacher —
      // distinguishing the two would let a teacher enumerate arbitrary
      // user ids to discover who exists on the platform.
      throw new NotFoundException('This student does not share a classroom with you');
    }

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id, full_name, avatar_url, linkedin_url')
      .eq('id', studentUserId)
      .maybeSingle();

    if (!profile) {
      throw new NotFoundException('This student does not share a classroom with you');
    }

    return {
      userId:      profile.id,
      fullName:    profile.full_name,
      avatarUrl:   profile.avatar_url,
      linkedinUrl: profile.linkedin_url,
      sharedClassrooms: sharedMemberships.map((m: any) => ({
        classroomId:        m.classroom_id,
        classroomName:      m.classroom?.name,
        batchYear:          m.classroom?.batch_year,
        globalId:           m.classroom?.global_id,
        role:               m.role,
        verificationStatus: m.verification_status,
        joinedAt:           m.joined_at,
      })),
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async assertTeacher(userId: string): Promise<void> {
    const { data } = await this.supabase
      .from('personas')
      .select('id')
      .eq('user_id', userId)
      .eq('type', PersonaType.TEACHER)
      .eq('status', 'active')
      .maybeSingle();

    if (!data) {
      throw new ForbiddenException('A teacher persona is required to search students');
    }
  }

  private async getVerifiedTeacherClassroomIds(teacherId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('memberships')
      .select('classroom_id')
      .eq('user_id', teacherId)
      .eq('role', 'teacher')
      .eq('verification_status', 'verified');

    if (error) {
      this.logger.error('Failed to load verified teacher classrooms', { error, teacherId });
      throw new BadRequestException('Failed to load your verified classrooms');
    }

    return (data ?? []).map((m) => m.classroom_id);
  }
}
