/**
 * CorridorService — messaging: read/send/delete, plus system messages and
 * event cards posted on behalf of other modules (SPEC.md §9, §10).
 *
 * ACCESS CONTROL — the whole point of this module's existence as a
 * gatekeeper in front of a table Supabase Realtime also broadcasts:
 * - WRITES always go through MembershipService.canAccessChannel(), which
 *   only returns true for a VERIFIED member with the right role for that
 *   channel. There is no degraded "post while unverified" mode anywhere.
 * - READS are gated separately from POST access — see getMessages()'s own
 *   doc comment. classroom: unverified members get a redacted read rather
 *   than a lock (SPEC.md §7.4). staff_room and student_alley are now
 *   SYMMETRIC hard locks: staff_room is teacher/admin-only (students get
 *   403, not a degraded view), student_alley is student-only (teachers/
 *   admins get 403) — reversed from an earlier design that let students
 *   read staff_room; see this file's own [CHANNEL-DEBUG] fix for why.
 *
 * REDACTION vs DELETION — two independent transforms, see presentMessage():
 * - A DELETED message (is_deleted=true) reads as a tombstone — content and
 *   sender both null — for EVERY viewer regardless of their own
 *   verification status (SPEC.md §9.3's tombstone isn't scoped to viewer
 *   verification).
 * - A message from an UNVERIFIED viewer's perspective (not deleted) gets
 *   content replaced with appConfig.REDACTED_CONTENT_PLACEHOLDER and the
 *   sender's name run through redactName() — never sent to the client
 *   unredacted, matching SPEC.md §18.2's "never rely on frontend-only
 *   blurring" rule that every other redaction in this codebase follows
 *   (ClassroomService.getMembers() does the identical thing for the member
 *   roster). Redaction is keyed on the VIEWER's own status, not the
 *   sender's — verification is a one-time, permanent event (SPEC.md §1.2),
 *   so a message's original sender is never "un-verified" after the fact;
 *   there's nothing to redact based on who wrote it.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SUPABASE REALTIME — how the frontend subscribes, and where this breaks
 * ═══════════════════════════════════════════════════════════════════════
 * This backend does NOT manage WebSocket connections. It only writes rows
 * to `messages` (INSERT here, UPDATE for soft-delete); Supabase's own
 * Realtime service watches the table's WAL and pushes changes to whatever
 * clients are subscribed. The frontend subscribes directly to Supabase,
 * not through this API:
 *
 *   const channel = supabase
 *     .channel(`messages:${classroomId}:${channelName}`)
 *     .on('postgres_changes',
 *       { event: '*', schema: 'public', table: 'messages',
 *         filter: `classroom_id=eq.${classroomId}` },
 *       (payload) => { ... })
 *     .subscribe();
 *
 * Filter client-side on `payload.new.channel === channelName` too —
 * Postgres changes filters support one column comparison, not two, so the
 * classroom_id filter narrows the stream and the channel check happens in
 * the callback.
 *
 * TWO THINGS THE FRONTEND TEAM NEEDS TO KNOW BEFORE WIRING THIS UP,
 * NEITHER OF WHICH THIS MODULE CAN FIX BY ITSELF:
 *
 * 1. REDACTION DOES NOT APPLY TO RAW REALTIME PAYLOADS. This service's
 *    presentMessage() redaction only runs for GET /corridor/:id/:channel —
 *    it can't intercept what Supabase Realtime pushes directly from
 *    Postgres. That's fine PROVIDED Realtime's own delivery is gated by
 *    the `messages_classroom_read` RLS policy (001_initial_schema.sql),
 *    which — importantly — requires verification_status = 'verified' for
 *    the 'classroom' channel too, NOT just staff_room/student_alley. In
 *    other words: RLS gives an unverified member's Realtime subscription
 *    ZERO rows for any channel, not redacted ones. An unverified member's
 *    client must therefore poll/refetch GET /corridor/:id/classroom (which
 *    IS redacted) rather than subscribe directly — subscribing them to
 *    Realtime for the classroom channel wouldn't leak data, but it also
 *    wouldn't show them anything, so don't bother trying.
 *
 * 2. RLS-GATED REALTIME NEEDS auth.uid() TO RESOLVE, WHICH NEEDS A REAL
 *    SUPABASE AUTH SESSION ON THE CLIENT. AuthModule (this codebase) issues
 *    its OWN access/refresh JWTs, signed with process.env.JWT_SECRET — NOT
 *    a Supabase Auth session. A Realtime client authenticated only with
 *    that custom token has no `auth.uid()` inside Postgres, so the
 *    `m.user_id = auth.uid()` clauses in every messages_* RLS policy never
 *    match: a verified member subscribing with just this API's access
 *    token would ALSO see nothing, not because of redaction but because
 *    RLS can't identify them at all. Closing this gap is an auth-module-
 *    level decision (e.g. also mint a Supabase session at login and pass
 *    it to `supabase.auth.setSession()` on the client, or move Realtime
 *    delivery to Supabase's Broadcast feature with server-signed channel
 *    authorization instead of Postgres Changes + RLS) — out of scope for
 *    this module, flagged here so it isn't discovered as a surprise later.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../membership/membership.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType, ChannelType, ErrorCode, MemberRole, MessageType } from '@alumini/types';
import { getRange, redactName } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';

import { SendMessageDto } from './dto/send-message.dto';

/**
 * Shape returned to callers — deliberately looser than @alumini/types'
 * Message/RedactedMessage unions so one function can produce either.
 * Exported (not just used internally) because CorridorController's
 * getMessages() return type is inferred from this — with
 * tsconfig's declaration:true, an unexported type used in a public
 * method's inferred return type fails to build (TS4053: "cannot be named").
 */
export interface PresentedMessage {
  id: string;
  classroomId: string;
  channel: ChannelType;
  messageType: MessageType;
  metadata: Record<string, unknown> | null;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  content: string | null;
  sender: { id: string; fullName: string; avatarUrl: string | null } | null;
  isRedacted?: true;
}

@Injectable()
export class CorridorService {
  private readonly logger = new Logger(CorridorService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(
    private readonly audit: AuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly membershipService: MembershipService,
    appLogger: AppLogger,
  ) {
    this.appLogger = appLogger.setContext('CORRIDOR');
    // Service role — bypasses RLS, same pattern as every other module.
    // (Client-side Realtime subscriptions are a completely separate
    // connection that goes through the ANON key and IS subject to RLS —
    // see the module-level comment above.)
    //
    // NOTE ON "Node.js detected but native WebSocket not found": every
    // createClient() call in this backend — not just this one — eagerly
    // constructs a @supabase/realtime-js RealtimeClient internally, which
    // throws that exact error on Node <22 (no global WebSocket) regardless
    // of whether the caller ever touches Realtime. There is no `realtime:
    // { enabled: false }` (or equivalent) option to opt out of this check —
    // RealtimeClientOptions has no such field (see
    // node_modules/@supabase/realtime-js's RealtimeClient.d.ts) — so it
    // isn't something the other 13 services' createClient() calls can be
    // individually configured around. The actual fix is the repo's Node
    // version: .node-version/.nvmrc pin to 22, which has the native
    // WebSocket global RealtimeClient needs and the SDK's own suggested
    // remedy for this exact error.
    //
    // Separately: this service's own createClient() call never explicitly
    // "enables" Realtime either — delivery to subscribed browser clients
    // happens via Supabase watching Postgres's WAL for row changes on
    // corridor.messages, triggered automatically by this service's own
    // inserts, not by this backend client subscribing to a channel itself.
    // Realtime is a client-side (browser) concern end to end; it isn't a
    // per-backend-service toggle to turn on here and off elsewhere.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /**
   * Paginated messages for one channel.
   *
   * READ access only differs from POST access (canAccessChannel(), used by
   * sendMessage() below) for the 'classroom' channel:
   * - classroom: any verified/pending_auto member reads normally; a plain
   *   'pending'/'rejected' member (or one who hasn't verified yet) still
   *   gets a degraded, redacted read rather than a hard lock (SPEC.md §7.4).
   * - staff_room: teacher/admin only, same as POST — a student gets a hard
   *   403, not a degraded view. Unverified teachers/admins also get no
   *   access until they verify.
   * - student_alley: student only, same as POST — teachers/admins get a
   *   hard 403 (privacy: this channel is explicitly private to students).
   *
   * Reads the membership row directly rather than going through
   * MembershipService.canAccessChannel() (which only answers the stricter
   * "may fully read+post" question — reading it here separately still lets
   * the classroom channel's degraded/redacted mode exist without teaching
   * canAccessChannel() about it) — same established cross-module
   * table-access pattern every module since auth has used.
   */
  async getMessages(userId: string, classroomId: string, channel: ChannelType, page = 0) {
    this.appLogger.debug('[CORRIDOR:getMessages] entry', { classroomId, channel, userId, page });

    const { data: membership } = await this.supabase
      .from('memberships')
      .select('role, verification_status, joined_at')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    this.appLogger.debug('[CORRIDOR:getMessages] membership check', {
      role: membership?.role,
      verificationStatus: membership?.verification_status,
    });

    if (!membership) {
      this.appLogger.warn('[CORRIDOR:getMessages] access denied', { userId, classroomId, channel, role: null });
      throw new ForbiddenException({
        message: 'Only members of this classroom can read its messages',
        error: ErrorCode.CHANNEL_ACCESS_DENIED,
      });
    }

    const hasFullAccess =
      membership.verification_status === 'verified' || membership.verification_status === 'pending_auto';

    let canRead = false;
    let redact = false;

    switch (channel) {
      case ChannelType.CLASSROOM:
        canRead = true;
        redact = !hasFullAccess;
        break;
      case ChannelType.STAFF_ROOM:
        // FIX 1 — was `hasFullAccess` alone (any role, students included).
        // Staff Room is now a hard lock for students, symmetric with
        // student_alley's own hard lock for teachers/admins below —
        // membership.role is read from THIS classroom_id's own row, never
        // a cross-classroom/global role.
        canRead = hasFullAccess && (membership.role === MemberRole.TEACHER || membership.role === MemberRole.ADMIN);
        break;
      case ChannelType.STUDENT_ALLEY:
        // Students only — teachers/admins are locked out entirely, not
        // just from posting (privacy, not a permissions technicality).
        canRead = hasFullAccess && membership.role === MemberRole.STUDENT;
        break;
    }

    if (!canRead) {
      this.appLogger.warn('[CORRIDOR:getMessages] access denied', { userId, classroomId, channel, role: membership.role });
      throw new ForbiddenException({
        message: 'You do not have access to this channel',
        error: ErrorCode.CHANNEL_ACCESS_DENIED,
      });
    }

    // TASKS_08 TASK 06 — messages sent before this user's own join date are
    // never returned, standard group-chat behaviour (WhatsApp/Slack/
    // Telegram). Welcome/system messages posted before a member joined
    // (e.g. classroom.created's welcome message) are filtered out along
    // with everything else — there's no separate carve-out for them.
    this.appLogger.debug('[CORRIDOR:getMessages] join date filter', {
      userId,
      classroomId,
      joinedAt: membership.joined_at,
    });

    const { from, to } = getRange(page, appConfig.MESSAGES_PAGE_SIZE);

    // BUG FIX (FIX 1 — "Something went wrong" on every tab): `messages` has
    // TWO foreign keys into `profiles` (sender_id and deleted_by), so a bare
    // `sender:profiles(...)` embed is ambiguous to PostgREST — it can't tell
    // which FK to join through and every single call to this method failed
    // with a Supabase relationship error, regardless of channel. The
    // `!messages_sender_id_fkey` hint disambiguates it. Same fix pattern
    // already established in this codebase for the identical situation —
    // see admin.service.ts's `requester:profiles!institution_requests_requested_by_fkey(...)`.
    // (Postgres auto-names an unnamed FK constraint `<table>_<column>_fkey`
    // — 001_initial_schema.sql never names this one explicitly.)
    const { data: messages, error } = await this.supabase
      .from('messages')
      .select(
        'id, classroom_id, channel, sender_id, content, message_type, metadata, ' +
          'is_deleted, deleted_by, deleted_at, created_at, sender:profiles!messages_sender_id_fkey(id, full_name, avatar_url)',
      )
      .eq('classroom_id', classroomId)
      .eq('channel', channel)
      .gte('created_at', membership.joined_at)
      .order('created_at', { ascending: false })
      .range(from, to);

    this.appLogger.debug('[CORRIDOR:getMessages] query result', { count: messages?.length, error: error?.message });

    if (error) {
      this.appLogger.error('[CORRIDOR:getMessages] failed', {
        classroomId,
        channel,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException({
        message: 'Failed to load messages',
        error: ErrorCode.MESSAGES_LOAD_FAILED,
      });
    }

    this.appLogger.info('[CORRIDOR:getMessages] success', { classroomId, channel, count: messages?.length ?? 0 });
    return (messages ?? []).map((m: any) => this.presentMessage(m, redact));
  }

  /**
   * Applies the two independent transforms described in the module-level
   * comment: deletion tombstone (unconditional) takes priority over
   * unverified-viewer redaction (conditional on `redact`).
   */
  private presentMessage(m: any, redact: boolean): PresentedMessage {
    const base = {
      id:          m.id,
      classroomId: m.classroom_id,
      channel:     m.channel,
      messageType: m.message_type,
      metadata:    m.metadata ?? null,
      createdAt:   m.created_at,
    };

    if (m.is_deleted) {
      return { ...base, isDeleted: true, deletedAt: m.deleted_at, content: null, sender: null };
    }

    if (redact) {
      return {
        ...base,
        isDeleted: false,
        deletedAt: null,
        content: appConfig.REDACTED_CONTENT_PLACEHOLDER,
        sender: m.sender ? { id: m.sender.id, fullName: redactName(m.sender.full_name), avatarUrl: null } : null,
        isRedacted: true,
      };
    }

    return {
      ...base,
      isDeleted: false,
      deletedAt: null,
      content: m.content,
      sender: m.sender ? { id: m.sender.id, fullName: m.sender.full_name, avatarUrl: m.sender.avatar_url } : null,
    };
  }

  // ── Write ────────────────────────────────────────────────────────────────

  /**
   * Sends a message. canAccessChannel() gates this unconditionally — there
   * is no degraded "post while unverified" mode (SPEC.md §7.4: unverified
   * members are read-only), so a false result here is always a hard 403,
   * even for the classroom channel.
   */
  async sendMessage(userId: string, classroomId: string, channel: ChannelType, dto: SendMessageDto, req?: Request) {
    this.appLogger.debug('[CORRIDOR:send] entry', { classroomId, channel, userId, contentLength: dto.content?.length });

    const canAccess = await this.membershipService.canAccessChannel(userId, classroomId, channel);
    this.appLogger.debug('[CORRIDOR:send] membership check', { canAccess });
    if (!canAccess) {
      this.appLogger.warn('[CORRIDOR:send] access denied', { userId, classroomId, channel });
      throw new ForbiddenException({
        message: 'You do not have access to post in this channel',
        error: ErrorCode.CHANNEL_ACCESS_DENIED,
      });
    }

    const { data: message, error } = await this.supabase
      .from('messages')
      .insert({
        classroom_id: classroomId,
        channel,
        sender_id:    userId,
        content:      dto.content,
        message_type: dto.messageType ?? MessageType.TEXT,
        metadata:     dto.metadata ?? null,
      })
      .select()
      .single();

    this.appLogger.debug('[CORRIDOR:send] insert result', { success: !error && !!message, messageId: message?.id });

    if (error || !message) {
      this.appLogger.error('[CORRIDOR:send] failed', {
        classroomId,
        channel,
        error: error?.message,
        code: error?.code,
        hint: error?.hint,
        details: error?.details,
      });
      throw new BadRequestException('Failed to send message. Please try again.');
    }

    this.appLogger.info('[CORRIDOR:send] success', { classroomId, channel, messageId: message.id });

    // Supabase Realtime delivers the row itself to subscribed clients —
    // this event is for OTHER BACKEND MODULES (e.g. a future notification
    // module pushing "new message" alerts), not for the frontend chat UI.
    this.eventEmitter.emit('corridor.message.sent', {
      messageId: message.id,
      classroomId,
      channel,
      senderId: userId,
    });

    return message;
  }

  // ── Delete (soft only) ───────────────────────────────────────────────────

  /**
   * Soft-deletes a message: is_deleted=true, deleted_by, deleted_at. NEVER
   * a hard delete — SPEC.md §9.3's tombstone requirement and this
   * codebase's general "preserve the audit trail" rule (same reasoning as
   * personas being suspended rather than removed) both depend on the row
   * still existing.
   *
   * Rules: the sender may delete their own message; anyone else needs to
   * be a verified classroom admin.
   */
  async deleteMessage(userId: string, classroomId: string, messageId: string, req?: Request): Promise<void> {
    const { data: message } = await this.supabase
      .from('messages')
      .select('id, sender_id, is_deleted')
      .eq('id', messageId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.is_deleted) {
      throw new BadRequestException('This message has already been deleted');
    }

    const isOwnMessage = message.sender_id === userId;

    if (isOwnMessage) {
      // Defence in depth: canAccessChannel() already prevents an
      // unverified member from posting in the first place, so this really
      // only guards against a status that somehow changed since — not a
      // path this codebase's verification model (permanent, one-way) is
      // expected to hit in practice.
      const { data: membership } = await this.supabase
        .from('memberships')
        .select('verification_status')
        .eq('user_id', userId)
        .eq('classroom_id', classroomId)
        .maybeSingle();

      if (!membership || membership.verification_status !== 'verified') {
        throw new ForbiddenException('You must be a verified member to delete messages');
      }
    } else {
      const { data: adminMembership } = await this.supabase
        .from('memberships')
        .select('id')
        .eq('user_id', userId)
        .eq('classroom_id', classroomId)
        .eq('verification_status', 'verified')
        .or('role.eq.admin,is_creator.eq.true')
        .maybeSingle();

      if (!adminMembership) {
        throw new ForbiddenException('Only the sender or a verified classroom admin can delete this message');
      }
    }

    const { error } = await this.supabase
      .from('messages')
      .update({ is_deleted: true, deleted_by: userId, deleted_at: new Date().toISOString() })
      .eq('id', messageId);

    if (error) {
      this.logger.error('Failed to delete message', { error, messageId, classroomId });
      throw new BadRequestException('Failed to delete this message. Please try again.');
    }

    await this.audit.log({
      eventType:  AuditEventType.MESSAGE_DELETED,
      actorId:    userId,
      targetId:   messageId,
      targetType: 'message',
      metadata: {
        classroom_id:       classroomId,
        own_message:        isOwnMessage,
        original_sender_id: message.sender_id,
      },
      req,
    });
  }

  // ── System messages & event cards (cross-module event listeners) ────────
  //
  // These three handlers are how corridor participates in the "modules
  // emit, other modules listen" architecture (SPEC.md §15.1) — none of
  // them are reachable via HTTP. Failures here are logged, not thrown:
  // a missed welcome message shouldn't roll back the classroom creation
  // (or verification, or event) that triggered it, since that already
  // succeeded and was already audited by its own module.

  /**
   * ClassroomService emits this after successfully creating a classroom
   * (`{ classroomId, creatorId, globalId }`) — see classroom.service.ts.
   * Posts a welcome system message to the main classroom channel.
   */
  @OnEvent('classroom.created')
  async handleClassroomCreated(payload: { classroomId: string; creatorId: string; globalId: string }): Promise<void> {
    await this.postSystemMessage(
      payload.classroomId,
      ChannelType.CLASSROOM,
      `Welcome! This classroom (${payload.globalId}) was just created.`,
      { event: 'classroom.created' },
    );
  }

  /**
   * VerificationService's approveVerification() emits this on every
   * successful verification, via any method (`{ userId, classroomId,
   * method }`) — see verification.service.ts. Posts an announcement to the
   * classroom channel. Deliberately generic/anonymous in the visible text
   * (SPEC.md doesn't say whether to name the newly verified member, and
   * naming them by default risks exposing more than intended for members
   * who'd rather not be called out) — the user_id is still in metadata for
   * anyone building a richer client-side rendering later.
   */
  @OnEvent('verification.approved')
  async handleVerificationApproved(payload: { userId: string; classroomId: string; method: string }): Promise<void> {
    await this.postSystemMessage(
      payload.classroomId,
      ChannelType.CLASSROOM,
      'A new member has been verified in this classroom.',
      { event: 'verification.approved', user_id: payload.userId, method: payload.method },
    );
  }

  /**
   * ASSUMPTION: the events module (SPEC.md §10, not yet built in this
   * codebase) will emit 'event.created' with at least
   * `{ eventId, classroomId, title }` when an event is created — modelled
   * on the `events` table's own columns (001_initial_schema.sql) and on
   * every other module's "emit just enough for the listener to act"
   * convention. Auto-posts an event_card; metadata.event_id is what lets
   * the frontend render RSVP buttons instead of plain text (SPEC.md §10.1).
   *
   * TASKS_08 TASK 05 — the card is posted into the SAME channel the event
   * belongs to (defaulting to classroom for payloads from before this
   * field existed), not always the public classroom channel — otherwise a
   * staff_room/student_alley event's card would leak its existence to
   * members who can't see the event itself.
   */
  @OnEvent('event.created')
  async handleEventCreated(payload: { eventId: string; classroomId: string; title: string; channel?: ChannelType }): Promise<void> {
    const { error } = await this.supabase.from('messages').insert({
      classroom_id: payload.classroomId,
      channel:      payload.channel ?? ChannelType.CLASSROOM,
      sender_id:    null,
      content:      payload.title,
      message_type: MessageType.EVENT_CARD,
      metadata:     { event_id: payload.eventId },
    });

    if (error) {
      this.logger.error('Failed to post event card', { error, payload });
    }
  }

  /** Shared insert for the two system-message listeners above. sender_id is null — messages.sender_id is nullable precisely for system/event_card posts with no human author. */
  private async postSystemMessage(
    classroomId: string,
    channel: ChannelType,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase.from('messages').insert({
      classroom_id: classroomId,
      channel,
      sender_id:    null,
      content,
      message_type: MessageType.SYSTEM,
      metadata,
    });

    if (error) {
      this.logger.error('Failed to post system message', { error, classroomId, channel });
    }
  }
}
