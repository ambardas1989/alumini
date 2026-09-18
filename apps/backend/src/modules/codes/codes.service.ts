/**
 * CodesService — personal/batch institution code generation, listing with
 * lazy expiry, and CSV bulk import (SPEC.md §11.4, §11.5).
 *
 * ACCESS: every method here is a school-admin action. SPEC.md §11.2 lists
 * "Generate personal codes / Generate batch codes / Bulk import via CSV"
 * among the admin actions requiring MFA re-challenge, and §6.2 says
 * co-admins (not just primary) "can... manage codes" — so the gate is
 * "any ACTIVE school_admin persona at this institution"
 * (assertSchoolAdmin()), not primary-admin-only, and not the classroom-
 * level 'admin' membership role verification/events/corridor modules use.
 * MFA re-challenge itself is enforced by MfaChallengeGuard at the
 * controller, layered on top of JwtAuthGuard — same pairing the
 * institution module uses for its own admin-only routes.
 *
 * OWNERSHIP: owns institution_codes (001_initial_schema.sql,
 * expiry_logged_at added in 005_codes_module.sql). Reads
 * classrooms/institutions/personas directly for authorization and code
 * formatting — the same established cross-module table-access pattern
 * every module since auth has used. Also WRITES to classrooms during CSV
 * import (creating a classroom "if not exists" per SPEC.md §11.4 step 2) —
 * reusing ClassroomService's own generateClassroomId() logic rather than
 * re-deriving classroom IDs a different way.
 *
 * CODE FORMAT & UNIQUENESS: generateInstitutionCode() (@alumini/utils)
 * produces {COUNTRY}-{YEAR}-{RANDOM6}. Collisions are astronomically
 * unlikely (33^6 combinations) but the code's own UNIQUE constraint means
 * an unhandled collision would surface as a raw Postgres error —
 * generateUniqueCode() checks-then-inserts with a bounded retry
 * (appConfig.CODE_UNIQUENESS_MAX_RETRIES) instead, so a collision (however
 * unlikely) fails cleanly with a message asking to retry, not a 500.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AuditEventType, PersonaType } from '@alumini/types';
import {
  daysFromNow,
  isExpired,
  generateInstitutionCode,
  generateClassroomId,
  type ClassroomIdParams,
} from '@alumini/utils';
import { appConfig } from '@alumini/config/app';

import { GeneratePersonalCodeDto } from './dto/generate-personal-code.dto';
import { GenerateBatchCodeDto } from './dto/generate-batch-code.dto';
import { ImportCsvDto } from './dto/import-csv.dto';

/** One validated CSV row — SPEC.md §11.4's exact column set. */
interface ImportRow {
  first_name: string;
  last_name: string;
  email: string;
  class: string;
  section: string;
  batch_year: string;
  roll_number: string;
}

const REQUIRED_CSV_COLUMNS: Array<keyof ImportRow> = [
  'first_name', 'last_name', 'email', 'class', 'section', 'batch_year', 'roll_number',
];

@Injectable()
export class CodesService {
  private readonly logger = new Logger(CodesService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly audit: AuditService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    // Service role — bypasses RLS. institution_codes has NO client-facing
    // RLS policy at all (institution_codes_no_direct_access,
    // 001_initial_schema.sql) — every read and write goes through this API.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Generation ───────────────────────────────────────────────────────────

  async generatePersonalCode(userId: string, dto: GeneratePersonalCodeDto, req?: Request) {
    await this.assertSchoolAdmin(userId, dto.institutionId);
    const classroom = await this.assertClassroomBelongsToInstitution(dto.classroomId, dto.institutionId);
    const institution = await this.getInstitutionDetails(dto.institutionId);

    const code = await this.generateUniqueCode(institution.country_code, new Date().getFullYear());
    const expiresAt = daysFromNow(appConfig.CODE_EXPIRY_DAYS);

    const { data: codeRow, error } = await this.supabase
      .from('institution_codes')
      .insert({
        institution_id: dto.institutionId,
        classroom_id:   classroom.id,
        code,
        type:            'personal',
        bound_name:      dto.boundName,
        bound_email:     dto.boundEmail,
        max_redemptions: null,
        expires_at:      expiresAt.toISOString(),
        generated_by:    userId,
      })
      .select()
      .single();

    if (error || !codeRow) {
      this.logger.error('Failed to generate personal code', { error, classroomId: dto.classroomId });
      throw new BadRequestException('Failed to generate code. Please try again.');
    }

    await this.audit.log({
      eventType:  AuditEventType.CODE_GENERATED,
      actorId:    userId,
      targetId:   codeRow.id,
      targetType: 'code',
      metadata: {
        classroom_id: dto.classroomId,
        institution_id: dto.institutionId,
        code_type: 'personal',
        // NOTE: bound_name/bound_email are NOT logged — same "no PII in
        // audit metadata" rule AuditService's own header comment states.
      },
      req,
    });

    // The one time the raw code is ever returned by this API — the admin
    // needs it to distribute to the bound recipient. institution_codes'
    // RLS blocks direct client reads of the table; it says nothing about
    // this response.
    return codeRow;
  }

  async generateBatchCode(userId: string, dto: GenerateBatchCodeDto, req?: Request) {
    await this.assertSchoolAdmin(userId, dto.institutionId);

    if (dto.maxRedemptions > appConfig.MAX_BATCH_CODE_REDEMPTIONS) {
      throw new BadRequestException(
        `max_redemptions cannot exceed ${appConfig.MAX_BATCH_CODE_REDEMPTIONS}`,
      );
    }

    const classroom = await this.assertClassroomBelongsToInstitution(dto.classroomId, dto.institutionId);
    const institution = await this.getInstitutionDetails(dto.institutionId);

    const code = await this.generateUniqueCode(institution.country_code, new Date().getFullYear());
    const expiresAt = daysFromNow(appConfig.CODE_EXPIRY_DAYS);

    const { data: codeRow, error } = await this.supabase
      .from('institution_codes')
      .insert({
        institution_id:   dto.institutionId,
        classroom_id:      classroom.id,
        code,
        type:               'batch',
        max_redemptions:    dto.maxRedemptions,
        redemption_count:   0,
        expires_at:         expiresAt.toISOString(),
        generated_by:       userId,
      })
      .select()
      .single();

    if (error || !codeRow) {
      this.logger.error('Failed to generate batch code', { error, classroomId: dto.classroomId });
      throw new BadRequestException('Failed to generate code. Please try again.');
    }

    await this.audit.log({
      eventType:  AuditEventType.CODE_GENERATED,
      actorId:    userId,
      targetId:   codeRow.id,
      targetType: 'code',
      metadata: {
        classroom_id: dto.classroomId,
        institution_id: dto.institutionId,
        code_type: 'batch',
        max_redemptions: dto.maxRedemptions,
      },
      req,
    });

    return codeRow;
  }

  /**
   * Generates a code and confirms it's not already in use before
   * inserting — see the module-level comment on why this loop exists
   * despite collisions being astronomically unlikely.
   */
  private async generateUniqueCode(countryCode: string, year: number): Promise<string> {
    for (let attempt = 0; attempt < appConfig.CODE_UNIQUENESS_MAX_RETRIES; attempt++) {
      const candidate = generateInstitutionCode(countryCode, year);

      const { data: existing } = await this.supabase
        .from('institution_codes')
        .select('id')
        .eq('code', candidate)
        .maybeSingle();

      if (!existing) {
        return candidate;
      }
    }

    throw new BadRequestException('Failed to generate a unique code. Please try again.');
  }

  // ── Listing (with lazy expiry) ───────────────────────────────────────────

  /**
   * All codes for a classroom, each annotated with a computed status
   * (active / redeemed / exhausted / expired). "Expired codes must be
   * excluded from active listings" (task requirement) is satisfied by
   * this per-code status computation itself — an expired code is labelled
   * 'expired', never 'active', rather than this endpoint silently omitting
   * expired rows from an admin's own view of their codes (which would be a
   * worse admin UX — they still need to see and clean these up).
   *
   * LAZY EXPIRY: the first time a code is observed past its expires_at, we
   * stamp expiry_logged_at and write AuditEventType.CODE_EXPIRED exactly
   * once — see 005_codes_module.sql's column comment for why the
   * dedup marker is needed.
   */
  async listCodes(userId: string, classroomId: string) {
    const classroom = await this.getClassroom(classroomId);
    await this.assertSchoolAdmin(userId, classroom.institution_id);

    // NOTE: the select column list must be a single string literal, not a
    // concatenation of several — supabase-js infers column/relationship
    // types from the literal string type, and `'a' + 'b'` widens to plain
    // `string`, which collapses its return type to an opaque
    // GenericStringError instead of the expected row shape.
    const { data: codes, error } = await this.supabase
      .from('institution_codes')
      .select('id, code, type, bound_name, bound_email, max_redemptions, redemption_count, is_redeemed, redeemed_at, expires_at, expiry_logged_at, created_at')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list codes', { error, classroomId });
      throw new BadRequestException('Failed to load codes');
    }

    // Explicit element type — a bare `const results = []` loses inference
    // across the `await this.logExpiryOnce(...)` inside this loop and
    // collapses to `never[]`.
    const results: Array<{
      id: string;
      code: string;
      type: string;
      boundName: string | null;
      boundEmail: string | null;
      maxRedemptions: number | null;
      redemptionCount: number;
      status: 'active' | 'redeemed' | 'exhausted' | 'expired';
      expiresAt: string;
      createdAt: string;
    }> = [];

    for (const c of codes ?? []) {
      const expired = isExpired(c.expires_at);

      if (expired && !c.expiry_logged_at) {
        await this.logExpiryOnce(c.id, classroomId, c.type, userId);
      }

      results.push({
        id:              c.id,
        code:            c.code,
        type:            c.type,
        boundName:       c.bound_name,
        boundEmail:      c.bound_email,
        maxRedemptions:  c.max_redemptions,
        redemptionCount: c.redemption_count,
        status:          this.computeStatus(c, expired),
        expiresAt:       c.expires_at,
        createdAt:       c.created_at,
      });
    }

    return results;
  }

  private computeStatus(
    c: { type: string; is_redeemed: boolean; redemption_count: number; max_redemptions: number | null },
    expired: boolean,
  ): 'active' | 'redeemed' | 'exhausted' | 'expired' {
    if (expired) return 'expired';
    if (c.type === 'personal' && c.is_redeemed) return 'redeemed';
    if (c.type === 'batch' && c.max_redemptions !== null && c.redemption_count >= c.max_redemptions) {
      return 'exhausted';
    }
    return 'active';
  }

  private async logExpiryOnce(codeId: string, classroomId: string, codeType: string, observedBy: string): Promise<void> {
    await this.supabase
      .from('institution_codes')
      .update({ expiry_logged_at: new Date().toISOString() })
      .eq('id', codeId);

    await this.audit.log({
      eventType:  AuditEventType.CODE_EXPIRED,
      actorId:    observedBy, // whoever's request surfaced the expiry — this is a system fact, not their action, but audit_logs has no "system" actor concept beyond a null actor_id (see AuditService), and attributing it to the admin who happened to look is more traceable than null
      targetId:   codeId,
      targetType: 'code',
      metadata:   { classroom_id: classroomId, code_type: codeType },
    });
  }

  // ── CSV bulk import ──────────────────────────────────────────────────────

  /**
   * SPEC.md §11.4. Validates structure up front (all-or-nothing — a
   * malformed CSV never partially imports), then per row: finds-or-creates
   * the (class, section, batch_year) classroom, generates a personal code,
   * and — if an email was given — emits a hand-off event for the
   * notification module to actually send it (same "this module doesn't
   * send email/SMS itself" pattern as every OTP/invite flow elsewhere in
   * this codebase).
   *
   * Per-row code generation failures are logged and skipped rather than
   * aborting the whole import — one bad row (e.g. a rare code collision
   * exhausting retries) shouldn't block 200 other students' codes.
   */
  async importCsv(userId: string, dto: ImportCsvDto, req?: Request) {
    await this.assertSchoolAdmin(userId, dto.institutionId);

    const rows = this.parseAndValidateCsv(dto.csvContent);
    const institution = await this.getInstitutionDetails(dto.institutionId);

    const classroomIdByKey = new Map<string, string>();
    const classroomIds = new Set<string>();
    let generatedCount = 0;

    for (const row of rows) {
      const key = `${row.class}|${row.section}|${row.batch_year}`;
      let classroomId = classroomIdByKey.get(key);

      if (!classroomId) {
        classroomId = await this.findOrCreateClassroom(institution, row, userId);
        classroomIdByKey.set(key, classroomId);
      }
      classroomIds.add(classroomId);

      let code: string;
      try {
        code = await this.generateUniqueCode(institution.country_code, Number(row.batch_year));
      } catch (err) {
        this.logger.error('Skipping CSV row — could not generate a unique code', {
          classroomId,
          // Deliberately not logging the row itself — first/last name,
          // email, roll number are all PII (SPEC.md §11.4 step 5's "not
          // content" rule applies here too, not just to the final audit entry).
        });
        continue;
      }

      const expiresAt = daysFromNow(appConfig.CODE_EXPIRY_DAYS);

      const { data: codeRow, error } = await this.supabase
        .from('institution_codes')
        .insert({
          institution_id: dto.institutionId,
          classroom_id:    classroomId,
          code,
          type:             'personal',
          bound_name:       `${row.first_name} ${row.last_name}`,
          bound_email:      row.email || null,
          expires_at:       expiresAt.toISOString(),
          generated_by:     userId,
        })
        .select('id')
        .single();

      if (error || !codeRow) {
        this.logger.error('Skipping CSV row — failed to save code', { classroomId });
        continue;
      }

      generatedCount++;

      if (row.email) {
        // Delivery (Resend credentials/templates) belongs to the
        // notification module — same hand-off pattern as every other
        // "this module generates, that module sends" flow in this codebase.
        this.eventEmitter.emit('codes.import.notify', {
          email:       row.email,
          firstName:   row.first_name,
          code,
          classroomId,
          expiresAt,
        });
      }
    }

    await this.audit.log({
      eventType:  AuditEventType.ADMIN_BULK_IMPORT,
      actorId:    userId,
      targetId:   dto.institutionId,
      targetType: 'institution',
      metadata: {
        row_count:       rows.length,
        generated_count: generatedCount,
        classroom_ids:   Array.from(classroomIds),
        // SPEC.md §11.4 step 5: "Audit log: bulk_import event with full
        // CSV metadata (not content)" — row/classroom COUNTS only, never
        // names, emails, or roll numbers.
      },
      req,
    });

    return { rowCount: rows.length, generatedCount, classroomIds: Array.from(classroomIds) };
  }

  /**
   * Parses and validates CSV structure per SPEC.md §11.4's exact column
   * set, failing the whole import before any row is processed if the
   * shape is wrong.
   */
  private parseAndValidateCsv(csvContent: string): ImportRow[] {
    let records: Record<string, string>[];

    try {
      records = parseCsvSync(csvContent, { columns: true, skip_empty_lines: true, trim: true });
    } catch {
      throw new BadRequestException('Malformed CSV file');
    }

    if (records.length === 0) {
      throw new BadRequestException('CSV file contains no data rows');
    }

    const actualColumns = Object.keys(records[0]);
    const missingColumns = REQUIRED_CSV_COLUMNS.filter((col) => !actualColumns.includes(col));

    if (missingColumns.length > 0) {
      throw new BadRequestException(`CSV is missing required columns: ${missingColumns.join(', ')}`);
    }

    records.forEach((row, index) => {
      // +2: 1-indexed rows, plus the header row itself.
      const rowNumber = index + 2;

      if (!row.first_name || !row.last_name || !row.class || !row.batch_year) {
        throw new BadRequestException(`Row ${rowNumber} is missing required data`);
      }
      if (!/^\d{4}$/.test(row.batch_year)) {
        throw new BadRequestException(`Row ${rowNumber} has an invalid batch_year`);
      }
    });

    // csv-parse's generic Record<string,string>[] and ImportRow are
    // structurally the same shape, but TS can't see that through a plain
    // Record index signature — the column presence check above is what
    // actually guarantees this cast is safe.
    return records as unknown as ImportRow[];
  }

  /** Finds the classroom for (class, section, batch_year) at this institution, creating it if needed — SPEC.md §11.4 step 2. */
  private async findOrCreateClassroom(
    institution: { id: string; country_code: string; city_code: string | null; slug: string },
    row: Pick<ImportRow, 'class' | 'section' | 'batch_year'>,
    creatorId: string,
  ): Promise<string> {
    const idParams: ClassroomIdParams = {
      countryCode:     institution.country_code,
      cityCode:        institution.city_code ?? undefined,
      institutionSlug: institution.slug,
      grade:           row.class,
      section:         row.section,
      batchYear:       Number(row.batch_year),
    };

    const globalId = generateClassroomId(idParams);

    const { data: existing } = await this.supabase
      .from('classrooms')
      .select('id')
      .eq('global_id', globalId)
      .maybeSingle();

    if (existing) {
      return existing.id;
    }

    const { data: created, error } = await this.supabase
      .from('classrooms')
      .insert({
        global_id:      globalId,
        institution_id: institution.id,
        name:           `Class ${row.class}${row.section ? ` ${row.section}` : ''} (${row.batch_year})`,
        batch_year:     Number(row.batch_year),
        grade:          row.class,
        section:        row.section || null,
        created_by:     creatorId,
      })
      .select('id')
      .single();

    if (error || !created) {
      this.logger.error('Failed to create classroom during CSV import', { error, globalId });
      throw new BadRequestException(`Failed to create classroom ${globalId} during import`);
    }

    return created.id;
  }

  // ── Internal: access control & lookups ───────────────────────────────────

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

  private async getClassroom(classroomId: string): Promise<{ id: string; institution_id: string }> {
    const { data } = await this.supabase
      .from('classrooms')
      .select('id, institution_id')
      .eq('id', classroomId)
      .maybeSingle();

    if (!data) {
      throw new NotFoundException('Classroom not found');
    }

    return data;
  }

  private async assertClassroomBelongsToInstitution(
    classroomId: string,
    institutionId: string,
  ): Promise<{ id: string; institution_id: string }> {
    const classroom = await this.getClassroom(classroomId);

    if (classroom.institution_id !== institutionId) {
      throw new BadRequestException('This classroom does not belong to the specified institution');
    }

    return classroom;
  }

  private async getInstitutionDetails(
    institutionId: string,
  ): Promise<{ id: string; country_code: string; city_code: string | null; slug: string }> {
    const { data } = await this.supabase
      .from('institutions')
      .select('id, country_code, city_code, slug')
      .eq('id', institutionId)
      .maybeSingle();

    if (!data) {
      throw new NotFoundException('Institution not found');
    }

    return data;
  }
}
