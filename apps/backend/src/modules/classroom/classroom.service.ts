/**
 * ClassroomService — classroom creation, lookup, and filing cabinet for teachers.
 *
 * Key responsibilities:
 * - Generate globally unique classroom IDs
 * - Prevent duplicate classrooms (check before create)
 * - Auto-add creator as verified admin member
 * - Organise classrooms by institution for teacher filing cabinet view
 */

import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuditService } from '../audit/audit.service';
import { AuditEventType, PersonaType } from '@alumini/types';
import { generateClassroomId, type ClassroomIdParams } from '@alumini/utils';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { Request } from 'express';

@Injectable()
export class ClassroomService {
  private readonly logger = new Logger(ClassroomService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {
    // Use service role to bypass RLS for server-side operations
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  /**
   * Create a new classroom.
   *
   * Flow:
   * 1. Fetch institution to get country/city codes for ID generation
   * 2. Generate global ID
   * 3. Check for duplicate (global_id already exists)
   * 4. Insert classroom
   * 5. Auto-add creator as verified admin
   * 6. Emit classroom.created event (triggers welcome system message)
   * 7. Write audit log
   *
   * @param creatorId - User ID of the person creating the classroom
   * @param dto - Validated creation data
   * @param req - Express request (for audit IP logging)
   */
  async createClassroom(
    creatorId: string,
    dto: CreateClassroomDto,
    req?: Request,
  ) {
    // 1. Fetch institution details needed for ID generation
    const { data: institution, error: instError } = await this.supabase
      .from('institutions')
      .select('id, country_code, city_code, slug, type')
      .eq('id', dto.institutionId)
      .single();

    if (instError || !institution) {
      throw new BadRequestException('Institution not found');
    }

    // 2. Generate the globally unique classroom ID
    const idParams: ClassroomIdParams = {
      countryCode:     institution.country_code,
      cityCode:        institution.city_code ?? undefined,
      institutionSlug: institution.slug,
      grade:           dto.grade,
      section:         dto.section,
      program:         dto.program,
      batchYear:       dto.batchYear,
    };

    const globalId = generateClassroomId(idParams);

    // 3. Check for duplicate — show existing classroom instead of creating
    const { data: existing } = await this.supabase
      .from('classrooms')
      .select('id, global_id, member_count')
      .eq('global_id', globalId)
      .maybeSingle();

    if (existing) {
      throw new ConflictException({
        message: `Classroom ${globalId} already exists.`,
        existingClassroomId: existing.id,
        globalId: existing.global_id,
        memberCount: existing.member_count,
        action: 'JOIN_INSTEAD',
      });
    }

    // 4. Create the classroom
    const { data: classroom, error: createError } = await this.supabase
      .from('classrooms')
      .insert({
        global_id:            globalId,
        institution_id:       dto.institutionId,
        name:                 dto.name,
        batch_year:           dto.batchYear,
        grade:                dto.grade ?? null,
        section:              dto.section ?? null,
        program:              dto.program ?? null,
        has_staff_room:       dto.hasStaffRoom ?? true,
        has_student_alley:    dto.hasStudentAlley ?? true,
        require_verification: dto.requireVerification ?? true,
        created_by:           creatorId,
      })
      .select()
      .single();

    if (createError || !classroom) {
      this.logger.error('Failed to create classroom', { error: createError, dto });
      throw new BadRequestException('Failed to create classroom. Please try again.');
    }

    // 5. Auto-add creator as verified admin
    // Creator bypasses verification — they are implicitly trusted as classroom admin
    const { error: memberError } = await this.supabase
      .from('memberships')
      .insert({
        user_id:             creatorId,
        classroom_id:        classroom.id,
        role:                'admin',
        verification_status: 'verified',
        verification_method: 'creator',
        verified_at:         new Date().toISOString(),
      });

    if (memberError) {
      this.logger.error('Failed to add creator as admin member', { error: memberError });
      // Classroom was created — log the error but don't fail the whole operation
      // This should be extremely rare and is recoverable by the admin
    }

    // 6. Emit event — CorridorModule listens and posts a welcome system message
    this.events.emit('classroom.created', {
      classroomId: classroom.id,
      creatorId,
      globalId,
    });

    // 7. Write audit log
    await this.audit.log({
      eventType:  AuditEventType.CLASSROOM_CREATED,
      actorId:    creatorId,
      targetId:   classroom.id,
      targetType: 'classroom',
      metadata: {
        global_id:      globalId,
        institution_id: dto.institutionId,
        batch_year:     dto.batchYear,
      },
      persona: PersonaType.ALUMNI, // Classroom creation is an alumni/teacher action
      req,
    });

    this.logger.log(`Classroom created: ${globalId} by user ${creatorId}`);
    return classroom;
  }

  /**
   * Get a classroom by its global ID (used for deep links and invite links).
   *
   * Returns institution details joined in.
   * Does NOT check membership — public metadata is readable by all.
   */
  async getByGlobalId(globalId: string) {
    const { data, error } = await this.supabase
      .from('classrooms')
      .select(`
        *,
        institution:institutions (
          id, name, slug, type, city_code, country_code
        )
      `)
      .eq('global_id', globalId.toUpperCase())
      .single();

    if (error || !data) {
      throw new NotFoundException(`Classroom ${globalId} not found`);
    }

    return data;
  }

  /**
   * Get all classrooms for a user, organised by institution.
   * This powers the Teacher filing cabinet view.
   *
   * Returns:
   * {
   *   institution: { id, name, type, ... },
   *   classes: [
   *     { ...classroom, userRole, verificationStatus, isActive }
   *   ]  // sorted: active first, then by year desc
   * }[]
   */
  async getClassroomsByInstitution(userId: string) {
    const { data: memberships, error } = await this.supabase
      .from('memberships')
      .select(`
        role,
        verification_status,
        classroom:classrooms (
          id,
          global_id,
          name,
          batch_year,
          grade,
          section,
          program,
          member_count,
          institution:institutions (
            id, name, slug, type, city_code, country_code
          )
        )
      `)
      .eq('user_id', userId);

    if (error) {
      this.logger.error('Failed to fetch classrooms for user', { error, userId });
      throw new BadRequestException('Failed to fetch classrooms');
    }

    if (!memberships || memberships.length === 0) return [];

    const currentYear = new Date().getFullYear();

    // Group by institution ID
    const byInstitution = memberships.reduce<
      Record<string, { institution: any; classes: any[] }>
    >((acc, m: any) => {
      const inst = m.classroom.institution;
      if (!acc[inst.id]) {
        acc[inst.id] = { institution: inst, classes: [] };
      }

      acc[inst.id].classes.push({
        ...m.classroom,
        userRole:           m.role,
        verificationStatus: m.verification_status,
        // Active = current year or last year (still in session)
        isActive:           m.classroom.batch_year >= currentYear - 1,
      });

      return acc;
    }, {});

    // Sort classes within each institution: active first, then by year descending
    for (const inst of Object.values(byInstitution)) {
      inst.classes.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.batch_year - a.batch_year;
      });
    }

    return Object.values(byInstitution);
  }

  /**
   * Search institutions for autocomplete during classroom creation.
   * Uses trigram index for fuzzy matching.
   *
   * @param query - Partial institution name (min 2 chars enforced in controller)
   * @param countryCode - Optional filter to narrow results
   */
  async searchInstitutions(query: string, countryCode?: string) {
    let queryBuilder = this.supabase
      .from('institutions')
      .select('id, name, slug, type, city_code, country_code, email_domain')
      .ilike('name', `%${query}%`)
      .limit(10);

    if (countryCode) {
      queryBuilder = queryBuilder.eq('country_code', countryCode.toUpperCase());
    }

    const { data, error } = await queryBuilder;

    if (error) {
      this.logger.error('Institution search failed', { error, query });
      return [];
    }

    return data ?? [];
  }
}
