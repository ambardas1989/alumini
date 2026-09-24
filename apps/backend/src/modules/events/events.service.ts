/**
 * EventsService — event creation, listing, RSVPs, and deletion
 * (SPEC.md §10).
 *
 * ACCESS: every read and write requires the caller to be a VERIFIED member
 * of the classroom (getMembership()) — SPEC.md §10.1/§10.2 both say
 * "verified member(s)" with no unverified-read carve-out, unlike corridor's
 * messages. Deletion additionally requires a verified 'admin' membership
 * (assertClassroomAdmin()).
 *
 * CHANNELS (TASKS_08 TASK 05): events are channel-scoped like messages —
 * classroom (all verified members), staff_room (teacher/admin only),
 * student_alley (student only). channelAllowsRole()/visibleChannels() gate
 * create/read the same way MembershipService.canAccessChannel() gates
 * corridor messages.
 *
 * OWNERSHIP: owns `events` and `rsvps` (001_initial_schema.sql). Reads
 * `memberships` directly for the access checks above — the same
 * established cross-module table-access pattern every module since auth
 * has used.
 *
 * CROSS-MODULE EVENTS:
 * - Emits 'event.created' after insert. Two independent listeners:
 *   CorridorService.handleEventCreated() posts an event_card message
 *   (metadata.event_id) and only needs {eventId, classroomId, title};
 *   NotificationService.handleEventCreated() (added when the notification
 *   module was built) also needs eventDate/location/isOnline to compose
 *   the push/in-app notification body, so those were added to the payload
 *   rather than having notification re-fetch the row it was just handed.
 * - Emits 'event.deleted' on deletion. See deleteEvent()'s comment for the
 *   orphaned-event_card limitation this is meant to eventually address.
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
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { AuditEventType, ChannelType, MemberRole, RsvpStatus } from '@alumini/types';

import { CreateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';

/**
 * BUG FIX — "invalid input syntax for type uuid" (see
 * MembershipService's identical UUID_RE comment for the full root cause).
 * Every method below takes `:classroomId` straight off the URL — resolving
 * it before it reaches a `.eq('classroom_id', ...)` query keeps this
 * endpoint robust regardless of caller.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly supabase: SupabaseClient;
  private readonly appLogger: AppLogger;

  constructor(
    private readonly audit: AuditService,
    private readonly eventEmitter: EventEmitter2,
    appLogger: AppLogger,
  ) {
    this.appLogger = appLogger.setContext('EVENTS');
    // Service role — bypasses RLS, same pattern as every other module.
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  /** Resolves a `:classroomId` URL param to the classroom's internal UUID — see the UUID_RE comment above. */
  private async resolveClassroomId(classroomId: string): Promise<string | null> {
    if (UUID_RE.test(classroomId)) return classroomId;

    const { data: classroom } = await this.supabase
      .from('classrooms')
      .select('id')
      .eq('global_id', classroomId)
      .maybeSingle();

    return classroom?.id ?? null;
  }

  // ── Create ───────────────────────────────────────────────────────────────

  async createEvent(userId: string, classroomId: string, dto: CreateEventDto, req?: Request) {
    const channel = dto.channel ?? ChannelType.CLASSROOM;
    this.appLogger.debug('[EVENTS:create] entry', { userId, classroomId, channel, title: dto.title });
    const resolvedId = await this.resolveClassroomId(classroomId);
    if (!resolvedId) {
      throw new NotFoundException('Classroom not found');
    }
    classroomId = resolvedId;

    const membership = await this.getMembership(userId, classroomId);
    if (!membership || membership.verification_status !== 'verified') {
      throw new ForbiddenException('Only verified members of this classroom can do this');
    }
    if (!this.channelAllowsRole(channel, membership.role)) {
      this.appLogger.warn('[EVENTS:create] access denied', { userId, channel, role: membership.role });
      throw new ForbiddenException(`You do not have access to the ${channel} channel`);
    }

    // "must be in the future" is relative to request time — checked here,
    // not in the DTO (see CreateEventDto's comment).
    const eventDate = new Date(dto.eventDate);
    if (eventDate.getTime() <= Date.now()) {
      throw new BadRequestException('event_date must be in the future');
    }

    const { data: event, error } = await this.supabase
      .from('events')
      .insert({
        classroom_id: classroomId,
        created_by:   userId,
        title:        dto.title,
        event_date:   eventDate.toISOString(),
        location:     dto.location ?? null,
        description:  dto.description ?? null,
        is_online:    dto.isOnline ?? false,
        channel,
      })
      .select()
      .single();

    if (error || !event) {
      this.appLogger.error('[EVENTS:create] failed', {
        userId,
        classroomId,
        error: error?.message,
        code: error?.code,
        hint: error?.hint,
        details: error?.details,
      });
      throw new BadRequestException('Failed to create event. Please try again.');
    }

    this.appLogger.info('[EVENTS:create] success', { userId, classroomId, eventId: event.id, channel });

    // CorridorModule and NotificationModule both listen — see module comment.
    // channel is included so CorridorService.handleEventCreated() posts the
    // event_card into the SAME channel the event belongs to — posting a
    // staff_room/student_alley event's card into the public classroom
    // channel would leak its existence to members who can't see the event.
    this.eventEmitter.emit('event.created', {
      eventId:     event.id,
      classroomId,
      title:       dto.title,
      eventDate:   event.event_date,
      location:    dto.location,
      isOnline:    dto.isOnline ?? false,
      channel,
    });

    await this.audit.log({
      eventType:  AuditEventType.EVENT_CREATED,
      actorId:    userId,
      targetId:   event.id,
      targetType: 'event',
      metadata:   { classroom_id: classroomId, event_date: event.event_date },
      req,
    });

    return event;
  }

  // ── List ─────────────────────────────────────────────────────────────────

  /**
   * All events for a classroom, split into upcoming (event_date >= now)
   * and past, each with RSVP counts and the caller's own RSVP status.
   * Counts/own-status are aggregated in application code from a single
   * `rsvps` fetch rather than a SQL GROUP BY — same "aggregate in JS"
   * approach ClassroomService.getClassroomsByInstitution() already uses
   * for its own institution grouping, appropriate at this scale (a
   * classroom's event/RSVP volume is small; SPEC.md §15.5 only reaches for
   * heavier tooling — Redis, BullMQ — at 10k+ users).
   *
   * TASKS_09 TASK 08 — BUG FIX: this used to hard-require
   * verification_status === 'verified' to see ANY event, so a brand-new
   * joiner (still 'pending'/'pending_auto' until their verification method
   * resolves) got a 403 on the whole list instead of the classroom's
   * upcoming events. Per product rules: FUTURE events are visible to every
   * member regardless of verification status (there's nothing sensitive
   * about "there's a reunion next month" that needs gating); PAST events
   * stay verified-members-only, and only ones created after they joined
   * (an unverified member still shouldn't get a history dump the moment
   * they're approved — same "no seeing before you joined" rule TASKS_08
   * TASK 06 applies to messages). See canSeeEvent() below.
   */
  async listEvents(userId: string, classroomId: string) {
    const resolvedId = await this.resolveClassroomId(classroomId);
    if (!resolvedId) {
      throw new NotFoundException('Classroom not found');
    }
    classroomId = resolvedId;

    const membership = await this.getMembership(userId, classroomId);
    if (!membership) {
      throw new ForbiddenException('Only members of this classroom can do this');
    }
    const visibleChannels = this.visibleChannels(membership.role);
    this.appLogger.debug('[EVENTS:get] entry', { classroomId, userId, visibleChannels });

    const { data: events, error } = await this.supabase
      .from('events')
      .select('id, classroom_id, created_by, title, event_date, location, description, is_online, created_at, channel')
      .eq('classroom_id', classroomId)
      .in('channel', visibleChannels)
      .order('event_date', { ascending: true });

    if (error) {
      this.logger.error('Failed to list events', { error, classroomId });
      throw new BadRequestException('Failed to load events');
    }

    const visible = (events ?? []).filter((event) => this.canSeeEvent(membership, event));

    if (visible.length === 0) {
      return { upcoming: [], past: [] };
    }

    const { data: rsvps } = await this.supabase
      .from('rsvps')
      .select('event_id, user_id, status')
      .in('event_id', visible.map((e) => e.id));

    const enriched = visible.map((event) => this.withRsvpSummary(event, rsvps ?? [], userId));

    const now = Date.now();
    return {
      upcoming: enriched.filter((e) => new Date(e.eventDate).getTime() >= now),
      past:     enriched.filter((e) => new Date(e.eventDate).getTime() < now),
    };
  }

  /**
   * Future events: visible to any member regardless of verification
   * status. Past events: verified members only, and only ones created on
   * or after their own joined_at — see listEvents()'s own comment.
   */
  private canSeeEvent(
    membership: { verification_status: string; joined_at: string },
    event: { event_date: string; created_at: string },
  ): boolean {
    if (new Date(event.event_date).getTime() >= Date.now()) return true;
    return (
      membership.verification_status === 'verified' &&
      new Date(event.created_at).getTime() >= new Date(membership.joined_at).getTime()
    );
  }

  private withRsvpSummary(event: any, allRsvps: Array<{ event_id: string; user_id: string; status: string }>, userId: string) {
    const rsvpCounts = { going: 0, notGoing: 0, maybe: 0 };
    let userRsvp: RsvpStatus | undefined;

    for (const r of allRsvps) {
      if (r.event_id !== event.id) continue;
      if (r.status === RsvpStatus.GOING) rsvpCounts.going++;
      else if (r.status === RsvpStatus.NOT_GOING) rsvpCounts.notGoing++;
      else if (r.status === RsvpStatus.MAYBE) rsvpCounts.maybe++;
      if (r.user_id === userId) userRsvp = r.status as RsvpStatus;
    }

    return {
      id:           event.id,
      classroomId:  event.classroom_id,
      createdBy:    event.created_by,
      title:        event.title,
      eventDate:    event.event_date,
      location:     event.location,
      description:  event.description,
      isOnline:     event.is_online,
      createdAt:    event.created_at,
      channel:      event.channel,
      rsvpCounts,
      userRsvp,
    };
  }

  // ── Detail ───────────────────────────────────────────────────────────────

  /**
   * Single event with the full RSVP list, by name, grouped by status.
   * Not redacted: only verified members can RSVP in the first place
   * (upsertRsvp() enforces this), so — like message senders in the
   * corridor module — everyone named here was verified at the moment they
   * RSVPed, and verification is permanent (SPEC.md §1.2). No redaction
   * dilemma the way there is for classroom membership rosters.
   */
  async getEventDetail(userId: string, classroomId: string, eventId: string) {
    const resolvedId = await this.resolveClassroomId(classroomId);
    if (!resolvedId) {
      throw new NotFoundException('Classroom not found');
    }
    classroomId = resolvedId;

    const membership = await this.getMembership(userId, classroomId);
    if (!membership || membership.verification_status !== 'verified') {
      throw new ForbiddenException('Only verified members of this classroom can do this');
    }

    const { data: event } = await this.supabase
      .from('events')
      .select('id, classroom_id, created_by, title, event_date, location, description, is_online, created_at, channel')
      .eq('id', eventId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (!this.channelAllowsRole(event.channel, membership.role)) {
      throw new NotFoundException('Event not found');
    }

    const { data: rsvps } = await this.supabase
      .from('rsvps')
      .select('user_id, status, profile:profiles(id, full_name, avatar_url)')
      .eq('event_id', eventId);

    const grouped: Record<'going' | 'notGoing' | 'maybe', Array<{ userId: string; fullName: string; avatarUrl: string | null }>> = {
      going: [],
      notGoing: [],
      maybe: [],
    };

    for (const r of rsvps ?? []) {
      const entry = {
        userId:    r.user_id,
        fullName:  (r.profile as any)?.full_name ?? 'Unknown',
        avatarUrl: (r.profile as any)?.avatar_url ?? null,
      };
      if (r.status === RsvpStatus.GOING) grouped.going.push(entry);
      else if (r.status === RsvpStatus.NOT_GOING) grouped.notGoing.push(entry);
      else if (r.status === RsvpStatus.MAYBE) grouped.maybe.push(entry);
    }

    return {
      id:          event.id,
      classroomId: event.classroom_id,
      createdBy:   event.created_by,
      title:       event.title,
      eventDate:   event.event_date,
      location:    event.location,
      description: event.description,
      isOnline:    event.is_online,
      createdAt:   event.created_at,
      channel:     event.channel,
      rsvps:       grouped,
    };
  }

  // ── RSVP ─────────────────────────────────────────────────────────────────

  /** Upserts the caller's RSVP — rsvps has UNIQUE(event_id, user_id), so this both creates and updates. */
  async upsertRsvp(userId: string, classroomId: string, eventId: string, dto: RsvpDto, req?: Request) {
    await this.assertCanAccessEvent(userId, classroomId, eventId);

    const { data, error } = await this.supabase
      .from('rsvps')
      .upsert(
        { event_id: eventId, user_id: userId, status: dto.status, updated_at: new Date().toISOString() },
        { onConflict: 'event_id,user_id' },
      )
      .select()
      .single();

    if (error || !data) {
      this.logger.error('Failed to save RSVP', { error, userId, eventId });
      throw new BadRequestException('Failed to save your RSVP. Please try again.');
    }

    return data;
  }

  async removeRsvp(userId: string, classroomId: string, eventId: string): Promise<void> {
    await this.assertCanAccessEvent(userId, classroomId, eventId);

    const { data: existing } = await this.supabase
      .from('rsvps')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundException('You have not RSVPed to this event');
    }

    const { error } = await this.supabase.from('rsvps').delete().eq('id', existing.id);

    if (error) {
      this.logger.error('Failed to remove RSVP', { error, userId, eventId });
      throw new BadRequestException('Failed to remove your RSVP. Please try again.');
    }
  }

  // ── Delete (admin only) ──────────────────────────────────────────────────

  /**
   * Hard delete — unlike messages/personas elsewhere in this codebase,
   * `events` has no is_deleted/deleted_at column at all
   * (001_initial_schema.sql), so there is no soft-delete option here to
   * begin with. rsvps.event_id has ON DELETE CASCADE, so RSVPs for a
   * deleted event are cleaned up automatically.
   *
   * KNOWN LIMITATION — event_card orphan (documented per task instruction):
   * deleting an event does NOT touch the event_card MESSAGE corridor
   * posted for it (CorridorService.handleEventCreated()). That message's
   * metadata.event_id will keep pointing at a row that no longer exists —
   * an orphaned card still visible in chat history. This method emits
   * 'event.deleted' below so a future corridor listener COULD react (e.g.
   * soft-delete or edit that message), but no such listener exists yet;
   * adding one is corridor module's responsibility, out of scope here.
   * Until then, the frontend should treat a 404 from
   * GET /events/:classroomId/:eventId (e.g. after tapping a stale card's
   * RSVP button) as "this event was deleted," not a hard error.
   */
  async deleteEvent(userId: string, classroomId: string, eventId: string, req?: Request): Promise<void> {
    const resolvedId = await this.resolveClassroomId(classroomId);
    if (!resolvedId) {
      throw new NotFoundException('Classroom not found');
    }
    classroomId = resolvedId;

    await this.assertClassroomAdmin(userId, classroomId);
    await this.assertEventInClassroom(eventId, classroomId);

    const { error } = await this.supabase.from('events').delete().eq('id', eventId);

    if (error) {
      this.logger.error('Failed to delete event', { error, eventId, classroomId });
      throw new BadRequestException('Failed to delete this event. Please try again.');
    }

    this.eventEmitter.emit('event.deleted', { eventId, classroomId });

    await this.audit.log({
      eventType:  AuditEventType.EVENT_DELETED,
      actorId:    userId,
      targetId:   eventId,
      targetType: 'event',
      metadata:   { classroom_id: classroomId },
      req,
    });
  }

  // ── Internal: access control ─────────────────────────────────────────────

  private async getMembership(userId: string, classroomId: string): Promise<{ role: MemberRole; verification_status: string; joined_at: string } | null> {
    const { data } = await this.supabase
      .from('memberships')
      .select('role, verification_status, joined_at')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    return data;
  }

  /**
   * TASKS_08 TASK 05 — channel-scoped visibility, matching messages
   * (MembershipService.canAccessChannel()'s rules, applied locally here
   * rather than injecting MembershipModule — same direct-membership-read
   * pattern CorridorService.getMessages() already uses for its own
   * per-channel read rules).
   */
  private channelAllowsRole(channel: ChannelType | string, role: MemberRole): boolean {
    switch (channel) {
      case ChannelType.STAFF_ROOM:
        return role === MemberRole.TEACHER || role === MemberRole.ADMIN;
      case ChannelType.STUDENT_ALLEY:
        return role === MemberRole.STUDENT;
      default:
        return true; // classroom — any verified member
    }
  }

  private visibleChannels(role: MemberRole): ChannelType[] {
    const channels: ChannelType[] = [ChannelType.CLASSROOM];
    if (role === MemberRole.TEACHER || role === MemberRole.ADMIN) channels.push(ChannelType.STAFF_ROOM);
    if (role === MemberRole.STUDENT) channels.push(ChannelType.STUDENT_ALLEY);
    return channels;
  }

  /** Verified member of the classroom AND allowed into this specific event's channel — used by the RSVP endpoints. */
  private async assertCanAccessEvent(userId: string, classroomId: string, eventId: string): Promise<void> {
    const resolvedId = await this.resolveClassroomId(classroomId);
    if (!resolvedId) {
      throw new NotFoundException('Classroom not found');
    }
    classroomId = resolvedId;

    const membership = await this.getMembership(userId, classroomId);
    if (!membership || membership.verification_status !== 'verified') {
      throw new ForbiddenException('Only verified members of this classroom can do this');
    }

    const { data: event } = await this.supabase
      .from('events')
      .select('id, channel')
      .eq('id', eventId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!event || !this.channelAllowsRole(event.channel, membership.role)) {
      throw new NotFoundException('Event not found');
    }
  }

  private async assertClassroomAdmin(userId: string, classroomId: string): Promise<void> {
    const { data } = await this.supabase
      .from('memberships')
      .select('id, role, is_creator')
      .eq('user_id', userId)
      .eq('classroom_id', classroomId)
      .eq('verification_status', 'verified')
      .maybeSingle();

    if (!data || (data.role !== 'admin' && !data.is_creator)) {
      throw new ForbiddenException('Only a verified admin of this classroom can delete events');
    }
  }

  private async assertEventInClassroom(eventId: string, classroomId: string): Promise<void> {
    const { data } = await this.supabase
      .from('events')
      .select('id')
      .eq('id', eventId)
      .eq('classroom_id', classroomId)
      .maybeSingle();

    if (!data) {
      throw new NotFoundException('Event not found');
    }
  }
}
