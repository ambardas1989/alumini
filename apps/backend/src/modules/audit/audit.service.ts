/**
 * AuditService — central audit logging for all auditable events.
 *
 * RULES:
 * 1. Never catch errors silently — audit failures should be visible.
 * 2. Never store cleartext PII in metadata (names, emails, document content).
 *    Store IDs and event types only.
 * 3. All writes use service role (bypasses RLS — audit logs are server-only).
 * 4. Never expose this service to client-facing code that could be spoofed.
 *
 * USAGE:
 *   constructor(private readonly audit: AuditService) {}
 *
 *   await this.audit.log({
 *     eventType: AuditEventType.AUTH_LOGIN_SUCCESS,
 *     actorId: user.id,
 *     req,
 *   });
 */

import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';
import { AuditEventType, PersonaType } from '@alumini/types';
import { AppLogger } from '../../common/logger/logger.service';

export interface AuditLogParams {
  /** The type of event — use AuditEventType enum, never raw strings */
  eventType: AuditEventType;

  /** User who performed the action. Null for system-initiated events */
  actorId?: string;

  /** ID of the affected entity (user, classroom, institution, etc.) */
  targetId?: string;

  /** Type of the affected entity */
  targetType?: 'user' | 'classroom' | 'institution' | 'institution_request' | 'membership' | 'verification' | 'code' | 'message' | 'event';

  /**
   * Additional event-specific data.
   * MUST NOT contain cleartext PII.
   * Use IDs, enums, and counts instead of names or emails.
   */
  metadata?: Record<string, unknown>;

  /** Express request object — used to extract IP and user agent */
  req?: Request;

  /** Which persona was active when the action occurred */
  persona?: PersonaType;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(appLogger: AppLogger) {
    this.appLogger = appLogger.setContext('AUDIT');
    // Use service role key — bypasses RLS for audit log writes
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  /**
   * Write an audit log entry.
   *
   * This method should not throw — audit failures are logged but
   * should not interrupt the main operation. However, the error
   * IS logged so ops teams can detect and fix audit gaps.
   *
   * @param params - Audit event parameters
   */
  async log(params: AuditLogParams): Promise<void> {
    const { eventType, actorId, targetId, targetType, metadata, req, persona } = params;

    // Extract IP and user agent from request if provided
    const ipAddress = req
      ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        ?? req.socket?.remoteAddress
      : undefined;

    const userAgent = req?.headers['user-agent'];

    try {
      const { error } = await this.supabase.from('audit_logs').insert({
        event_type:   eventType,
        actor_id:     actorId ?? null,
        target_id:    targetId ?? null,
        target_type:  targetType ?? null,
        metadata:     metadata ?? null,
        ip_address:   ipAddress ?? null,
        user_agent:   userAgent ?? null,
        persona:      persona ?? null,
      });

      if (error) {
        // Log the failure but don't throw — audit must not break core flows
        this.appLogger.error('Record failed', { error: error.message });
        this.logger.error(
          `Failed to write audit log [${eventType}]: ${error.message}`,
          { actorId, targetId, eventType },
        );
        return;
      }

      this.appLogger.debug('Event recorded', { actor: actorId ?? null, action: eventType, resource: targetId ?? null });
    } catch (err) {
      this.appLogger.error('Record failed', { error: err instanceof Error ? err.message : String(err) });
      this.logger.error(
        `Exception writing audit log [${eventType}]`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Retrieve audit logs for a specific actor (user viewing their own history).
   * Filtered to only show their own entries — never other users'.
   */
  async getForActor(
    actorId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    const { limit = 50, offset = 0 } = options;

    const { data, error } = await this.supabase
      .from('audit_logs')
      .select('*')
      .eq('actor_id', actorId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to fetch audit logs: ${error.message}`);
    return data;
  }

  /**
   * Retrieve audit logs for a specific institution (school admin view).
   * Returns events involving that institution's classrooms, verifications, and codes.
   * School admins can only see their institution's logs.
   */
  async getForInstitution(
    institutionId: string,
    options: { limit?: number; offset?: number; eventType?: AuditEventType } = {},
  ) {
    const { limit = 50, offset = 0, eventType } = options;

    let query = this.supabase
      .from('audit_logs')
      .select('*')
      .contains('metadata', { institution_id: institutionId })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch institution audit logs: ${error.message}`);
    return data;
  }
}
