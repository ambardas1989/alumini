/**
 * NotificationService — push (FCM), in-app, and email (Resend) delivery
 * (SPEC.md §9, feature F40).
 *
 * PURELY EVENT-DRIVEN: every public @OnEvent() handler below is triggered
 * by another module's EventEmitter2.emit() call — nothing in this module
 * is ever invoked directly by a controller, and this module has no
 * controller of its own (see notification.module.ts). Handlers never
 * throw: a failed notification must never roll back or surface as an
 * error on the action that triggered it (a verification approval that
 * already succeeded shouldn't fail because the push notification did) —
 * every failure path here logs and returns.
 *
 * EVENTS HANDLED (exactly the eight this task specifies):
 *   verification.email.initiate      → OTP email (Resend)
 *   verification.document.submitted  → in-app to classroom admins
 *   verification.document.approved   → in-app + push to applicant
 *   verification.document.rejected   → in-app to applicant (with reason)
 *   verification.approved            → in-app + push to member
 *   institution.admin.invited        → invitation email with magic link
 *   classroom.created                → NOT handled here, deliberately —
 *                                       corridor posts the welcome system
 *                                       message instead (see below)
 *   event.created                    → in-app + push to verified members
 *
 * EVENTS THIS MODULE DOES NOT YET HANDLE (documented, not forgotten):
 * auth module's 'mfa.sms.send' (SMS OTP via Twilio — twilio is already a
 * dependency, anticipating this), codes module's 'codes.import.notify'
 * (emailing bulk-imported students their codes), and institution module's
 * 'institution.claim.submitted' / '.approved' / '.rejected' /
 * 'institution.admin.accepted'. None of these are in this task's event
 * list — adding handlers for them is future work, not an oversight.
 *
 * TWO EXISTING EMITTERS WERE EXTENDED to build this module (both changes
 * are additive — existing listeners are unaffected):
 * - VerificationService's 'verification.document.approved' now also
 *   carries `userId` (verification.service.ts) — needed to notify the
 *   applicant without a second query.
 * - EventsService's 'event.created' now also carries `eventDate`,
 *   `location`, `isOnline` (events.service.ts) — needed for the
 *   notification body ("date and location" per this task).
 *
 * GRACEFUL DEGRADATION — this module must never crash the app at boot
 * just because delivery credentials are absent in a given environment:
 * - RESEND_API_KEY missing → email sends are skipped (logged once at
 *   startup, then silently per-call).
 * - FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
 *   missing (any one) → push is skipped entirely (task's explicit
 *   requirement). Email still works independently.
 * - A single invalid/expired FCM token during sendPush() is logged and
 *   skipped — it does not stop delivery to the user's other devices.
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
// Imported under a distinct alias, never `admin` — this codebase uses
// `admin` constantly as a variable/role name (classroom admins, school
// admins, membership.role === 'admin'); aliasing avoids any risk of a
// local variable silently shadowing the SDK namespace.
import * as firebaseAdmin from 'firebase-admin';

import { appConfig } from '@alumini/config/app';
import { brand } from '@alumini/config/brand';
import { AppLogger } from '../../common/logger/logger.service';

/** Named Firebase app instance — avoids colliding with any other admin.initializeApp() call and survives repeated NotificationService construction (e.g. multiple test module compiles in one process) without throwing "app already exists". */
const FIREBASE_APP_NAME = 'alumini-notification';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly supabase: SupabaseClient;
  private readonly resend: Resend | null;
  private readonly firebaseApp: firebaseAdmin.app.App | null;
  private readonly appLogger: AppLogger;

  constructor(appLogger: AppLogger) {
    this.appLogger = appLogger.setContext('NOTIFICATION');
    // Service role — bypasses RLS, same pattern as every other module.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    this.resend = this.initResend();
    this.firebaseApp = this.initFirebase();
  }

  private initResend(): Resend | null {
    if (!process.env.RESEND_API_KEY) {
      this.logger.warn('RESEND_API_KEY not set — email notifications will be skipped');
      return null;
    }
    return new Resend(process.env.RESEND_API_KEY);
  }

  /**
   * FCM setup note (task requirement): if any of the three Firebase env
   * vars is missing, log a warning and return null — every push call then
   * degrades to a no-op rather than throwing. Email keeps working
   * independently of this.
   */
  private initFirebase(): firebaseAdmin.app.App | null {
    const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;

    if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
      this.logger.warn(
        'Firebase credentials not fully configured (FIREBASE_PROJECT_ID/FIREBASE_PRIVATE_KEY/' +
          'FIREBASE_CLIENT_EMAIL) — push notifications will be skipped',
      );
      return null;
    }

    const existing = firebaseAdmin.apps.find((a) => a?.name === FIREBASE_APP_NAME);
    if (existing) {
      return existing;
    }

    try {
      return firebaseAdmin.initializeApp(
        {
          credential: firebaseAdmin.credential.cert({
            projectId: FIREBASE_PROJECT_ID,
            // .env files can't hold real newlines — PEM keys are stored
            // with literal "\n" escapes and unescaped here.
            privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            clientEmail: FIREBASE_CLIENT_EMAIL,
          }),
        },
        FIREBASE_APP_NAME,
      );
    } catch (err) {
      this.logger.error('Failed to initialize Firebase Admin SDK', err instanceof Error ? err.stack : String(err));
      return null;
    }
  }

  // ── Read side (TASK 08/09 — GET /notifications, mark-read) ──────────────
  //
  // Added on top of the purely event-driven module above: the frontend
  // activity feed (home) and notifications dropdown both need to read back
  // what sendInApp() has been writing to `notifications` all along — there
  // was no way to do that before this. NotificationController is the
  // module's first-ever controller/HTTP surface as a result.

  /** Paginated, newest-first. `unreadOnly` powers the badge-count poll without pulling full rows. */
  async getNotifications(userId: string, limit = 20, unreadOnly = false) {
    this.appLogger.debug('[NOTIF:get] entry', { userId, limit, unreadOnly });

    let query = this.supabase
      .from('notifications')
      .select('id, type, title, body, data, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;

    this.appLogger.debug('[NOTIF:get] result', { count: data?.length, error: error?.message });

    if (error) {
      this.appLogger.error('[NOTIF:get] failed', {
        userId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      return [];
    }

    return data ?? [];
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      this.logger.error('Failed to count unread notifications', { error, userId });
      return 0;
    }

    return count ?? 0;
  }

  /** Marks specific notification ids as read, or every one of the caller's if `all` is set. Always scoped to `userId` — never trusts a bare id list alone. */
  async markRead(userId: string, notificationIds?: string[], all?: boolean): Promise<void> {
    this.appLogger.debug('[NOTIF:markRead] entry', { userId, all: !!all, ids: notificationIds });

    if (!all && (!notificationIds || notificationIds.length === 0)) return;

    let query = this.supabase.from('notifications').update({ is_read: true }).eq('user_id', userId);

    if (!all) {
      query = query.in('id', notificationIds!);
    }

    const { error } = await query;

    this.appLogger.debug('[NOTIF:markRead] result', { success: !error });

    if (error) {
      this.appLogger.error('[NOTIF:markRead] failed', {
        userId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
    }
  }

  // ── Delivery primitives ──────────────────────────────────────────────────

  /**
   * Inserts an in-app notification. Supabase Realtime is already enabled
   * on this table at the project level (same mechanism corridor's
   * `messages` table uses) — this method only writes the row; broadcasting
   * to the subscribed client is Supabase's job, not this backend's (see
   * CorridorService's module comment for the fuller Realtime story, which
   * applies here identically).
   */
  async sendInApp(
    userId: string,
    type: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    this.appLogger.debug('[NOTIF:send] entry', { userId, type });

    const { data: inserted, error } = await this.supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        body,
        data: data ?? null,
      })
      .select()
      .single();

    if (error) {
      this.appLogger.error('[NOTIF:send] failed', {
        userId,
        type,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      return;
    }

    this.appLogger.info('[NOTIF:send] success', { userId, type, notificationId: inserted?.id });
  }

  /**
   * Looks up this user's active sessions with a registered FCM token
   * (there can be several — one per device) and sends to each. A missing
   * Firebase config, a user with no registered devices, or an individual
   * token that FCM rejects (uninstalled app, expired token) are all
   * handled gracefully — none of them throw.
   */
  async sendPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.firebaseApp) {
      return; // already warned once at startup — no need to repeat per call
    }

    const { data: sessions, error } = await this.supabase
      .from('sessions')
      .select('fcm_token')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .not('fcm_token', 'is', null);

    if (error) {
      this.logger.error('Failed to look up sessions for push', { error, userId });
      return;
    }

    const tokens = (sessions ?? [])
      .map((s) => s.fcm_token as string | null)
      .filter((t): t is string => !!t);

    if (tokens.length === 0) {
      return; // no registered devices — not an error condition
    }

    for (const token of tokens) {
      try {
        await firebaseAdmin.messaging(this.firebaseApp).send({
          token,
          notification: { title, body },
          data: data ?? {},
        });
      } catch (err) {
        // Gracefully handle missing/invalid tokens — log, don't throw.
        this.logger.warn(`Failed to send push to one device for user ${userId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Sends via Resend. `from` is env-configured (FROM_EMAIL, must be a
   * verified domain in Resend per .env.example) falling back to
   * brand.supportEmail — this task's own wording ("appConfig or
   * brand.supportEmail") is read as "an environment-configured address or
   * the brand default", since there is no FROM_EMAIL key in
   * packages/config/app.ts (it's a secret-adjacent, environment-specific
   * value, same category as JWT_SECRET or SUPABASE_URL elsewhere in this
   * codebase — never appConfig).
   */
  private async sendEmail(to: string, subject: string, text: string): Promise<void> {
    if (!this.resend) {
      return; // already warned once at startup
    }

    try {
      await this.resend.emails.send({
        from: process.env.FROM_EMAIL ?? brand.supportEmail,
        to,
        subject,
        text,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}`, err instanceof Error ? err.stack : String(err));
    }
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  /**
   * Method 1 OTP delivery. Plain text, brand.name in the subject —
   * never a hardcoded app name (task requirement).
   */
  @OnEvent('verification.email.initiate')
  async handleEmailOtpInitiate(payload: {
    userId: string;
    institutionalEmail: string;
    classroomId: string;
    code: string;
    expiresAt: Date;
  }): Promise<void> {
    const subject = `Your ${brand.name} verification code`;
    const text =
      `Your ${brand.name} verification code is ${payload.code}.\n\n` +
      `It expires in ${appConfig.EMAIL_OTP_EXPIRY_MINUTES} minutes. ` +
      `If you didn't request this, you can safely ignore this email.`;

    await this.sendEmail(payload.institutionalEmail, subject, text);
  }

  /** Method 3 step 1: alert every verified admin of the classroom that a document is waiting for review. */
  @OnEvent('verification.document.submitted')
  async handleDocumentSubmitted(payload: { userId: string; classroomId: string }): Promise<void> {
    const { data: classroomAdmins, error } = await this.supabase
      .from('memberships')
      .select('user_id')
      .eq('classroom_id', payload.classroomId)
      .eq('verification_status', 'verified')
      .or('role.eq.admin,is_creator.eq.true');

    if (error) {
      this.logger.error('Failed to look up classroom admins to notify', { error, classroomId: payload.classroomId });
      return;
    }

    for (const adminMembership of classroomAdmins ?? []) {
      await this.sendInApp(
        adminMembership.user_id,
        'verification.document.submitted',
        'New verification document to review',
        'A member submitted a document for verification review.',
        { classroom_id: payload.classroomId, applicant_user_id: payload.userId },
      );
    }
  }

  /** Method 3 step 2a: tell the applicant their document was approved — in-app + push. */
  @OnEvent('verification.document.approved')
  async handleDocumentApproved(payload: {
    userId: string;
    storagePath: string;
    verificationId: string;
  }): Promise<void> {
    const title = 'Verification approved';
    const body = 'Your document verification was approved. You now have full access to this classroom.';

    await this.sendInApp(payload.userId, 'verification.document.approved', title, body, {
      verification_id: payload.verificationId,
    });

    await this.sendPush(payload.userId, `${brand.name}: ${title}`, body, {
      type: 'verification.document.approved',
      verification_id: payload.verificationId,
    });
  }

  /** Method 3 step 2b: tell the applicant why their document was rejected — in-app only (no push specified for this one). */
  @OnEvent('verification.document.rejected')
  async handleDocumentRejected(payload: {
    userId: string;
    classroomId: string;
    reason: string;
  }): Promise<void> {
    await this.sendInApp(
      payload.userId,
      'verification.document.rejected',
      'Verification rejected',
      payload.reason,
      { classroom_id: payload.classroomId },
    );
  }

  /** Fired by ANY successful verification method (VerificationService.approveVerification()) — in-app + push. */
  @OnEvent('verification.approved')
  async handleVerificationApproved(payload: {
    userId: string;
    classroomId: string;
    method: string;
  }): Promise<void> {
    const title = 'You are now verified';
    const body = 'You now have full access to this classroom.';

    await this.sendInApp(payload.userId, 'verification.approved', title, body, {
      classroom_id: payload.classroomId,
      method: payload.method,
    });

    await this.sendPush(payload.userId, `${brand.name}: You're verified!`, body, {
      type: 'verification.approved',
      classroom_id: payload.classroomId,
    });
  }

  /**
   * SPEC.md §11.3 co-admin invitation email. The "magic link" points at
   * this API's own accept endpoint (GET /institution/invite/accept) via
   * APP_URL — there is no separate frontend app in this codebase yet to
   * route through instead; when one exists, this should point at a
   * frontend page that calls the API rather than the API directly.
   * Documented assumption, since SPEC.md doesn't define a web app base URL.
   */
  @OnEvent('institution.admin.invited')
  async handleAdminInvited(payload: {
    institutionId: string;
    email: string;
    invitedBy: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const baseUrl = process.env.APP_URL ?? 'http://localhost:3001';
    const acceptUrl = `${baseUrl}/v1/institution/invite/accept?token=${payload.token}`;

    const subject = `You've been invited to co-administer an institution on ${brand.name}`;
    const text =
      `You've been invited to become a co-admin on ${brand.name}.\n\n` +
      `Accept the invitation: ${acceptUrl}\n\n` +
      `This link expires ${new Date(payload.expiresAt).toLocaleString()}.`;

    await this.sendEmail(payload.email, subject, text);
  }

  // classroom.created — deliberately NOT handled. CorridorService already
  // posts the welcome system message (SPEC.md's "corridor handles system
  // message" per this task) — a notification here would be redundant.

  /** SPEC.md §10.1: notify every verified member when an event is created. */
  @OnEvent('event.created')
  async handleEventCreated(payload: {
    eventId: string;
    classroomId: string;
    title: string;
    eventDate: string;
    location?: string;
    isOnline?: boolean;
  }): Promise<void> {
    const { data: verifiedMembers, error } = await this.supabase
      .from('memberships')
      .select('user_id')
      .eq('classroom_id', payload.classroomId)
      .eq('verification_status', 'verified');

    if (error) {
      this.logger.error('Failed to look up verified members to notify', { error, classroomId: payload.classroomId });
      return;
    }

    const body = this.formatEventWhenWhere(payload.eventDate, payload.location, payload.isOnline);

    for (const member of verifiedMembers ?? []) {
      await this.sendInApp(member.user_id, 'event.created', payload.title, body, {
        event_id: payload.eventId,
        classroom_id: payload.classroomId,
      });

      await this.sendPush(member.user_id, payload.title, body, {
        type: 'event.created',
        event_id: payload.eventId,
      });
    }
  }

  /** "Title: event title, body: date and location" per this task. */
  private formatEventWhenWhere(eventDate: string, location?: string, isOnline?: boolean): string {
    const when = new Date(eventDate).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const where = isOnline ? 'Online' : location || 'Location TBD';
    return `${when} · ${where}`;
  }
}
