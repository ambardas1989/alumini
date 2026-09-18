/**
 * CorridorService — messaging: read/send/delete, plus system messages and
 * event cards posted on behalf of other modules (SPEC.md §9, §10).
 *
 * ACCESS CONTROL — the whole point of this module's existence as a
 * gatekeeper in front of a table Supabase Realtime also broadcasts:
 * - WRITES always go through MembershipService.canAccessChannel(), which
 *   only returns true for a VERIFIED member with the right role for that
 *   channel. There is no degraded "post while unverified" mode anywhere.
 * - READS start with the same canAccessChannel() check. If it says no,
 *   this module does NOT immediately reject — for the 'classroom' channel
 *   specifically, SPEC.md §7.4 carves out a degraded mode: a member who
 *   simply hasn't been verified yet may still read that one channel, with
 *   every message's content and sender redacted. staff_room/student_alley
 *   have no such carve-out (SPEC.md §7.3's table is unconditional for
 *   those two) — a canAccessChannel() failure there is a hard 403.
 *   See getMessages() for exactly how that's implemented.
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
import { AuditEventType, ChannelType, MessageType } from '@alumini/types';
import { getRange, redactName } from '@alumini/utils';
import { appConfig } from '@alumini/config/app';

import { SendMessageDto } from './dto/send-message.dto';

/** Shape returned to callers — deliberately looser than @alumini/types' Message/RedactedMessage unions so one function can produce either. */
interface PresentedMessage {
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

  constructor(
    private readonly audit: AuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly membershipService: MembershipService,
  ) {
    // Service role — bypasses RLS, same pattern as every other module.
    // (Client-side Realtime subscriptions are a completely separate
    // connection that goes through the ANON key and IS subject to RLS —
    // see the module-level comment above.)
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /**
   * Paginated messages for one channel. See the module-level comment for
   * the full access-control reasoning — short version: full access via
   * canAccessChannel(), a degraded redacted-read fallback for the
   * 'classroom' channel only, hard rejection otherwise.
   */
  async getMessages(userId: string, classroomId: string, channel: ChannelType, page = 0) {
    const hasFullAccess = await this.membershipService.canAccessChannel(userId, classroomId, channel);

    let redact = false;

    if (!hasFullAccess) {
      if (channel !== ChannelType.CLASSROOM) {
        throw new ForbiddenException('You do not have access to this channel');
      }

      // Plain "are they at least a member" check — MembershipService's
      // canAccessChannel() deliberately doesn't answer this (see its own
      // module comment); reading `memberships` directly here follows the
      // same established cross-module table-access pattern every module
      // since auth has used.
      const { data: membership } = await this.supabase
        .from('memberships')
        .select('id')
        .eq('user_id', userId)
        .eq('classroom_id', classroomId)
        .maybeSingle();

      if (!membership) {
        throw new ForbiddenException('Only members of this classroom can read its messages');
      }

      redact = true;
    }

    const { from, to } = getRange(page, appConfig.MESSAGES_PAGE_SIZE);

    const { data: messages, error } = await this.supabase
      .from('messages')
      .select(
        'id, classroom_id, channel, sender_id, content, message_type, metadata, ' +
          'is_deleted, deleted_by, deleted_at, created_at, sender:profiles(id, full_name, avatar_url)',
      )
      .eq('classroom_id', classroomId)
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error('Failed to load messages', { error, classroomId, channel });
      throw new BadRequestException('Failed to load messages');
    }

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
    const canAccess = await this.membershipService.canAccessChannel(userId, classroomId, channel);
    if (!canAccess) {
      throw new ForbiddenException('You do not have access to post in this channel');
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

    if (error || !message) {
      this.logger.error('Failed to send message', { error, userId, classroomId, channel });
      throw new BadRequestException('Failed to send message. Please try again.');
    }

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
        .eq('role', 'admin')
        .eq('verification_status', 'verified')
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
   */
  @OnEvent('event.created')
  async handleEventCreated(payload: { eventId: string; classroomId: string; title: string }): Promise<void> {
    const { error } = await this.supabase.from('messages').insert({
      classroom_id: payload.classroomId,
      channel:      ChannelType.CLASSROOM,
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
