/**
 * Unit tests for EventsService.
 *
 * Covers:
 * - createEvent(): verified-member gate, future-date validation, success
 *   (audited + event.created emitted)
 * - listEvents(): empty case, upcoming/past split with per-event RSVP
 *   counts and the caller's own status
 * - getEventDetail(): not-found guard, full RSVP list grouped by status
 * - upsertRsvp()/removeRsvp(): access + event-existence guards, success,
 *   no-existing-RSVP guard on remove
 * - deleteEvent(): admin-only gate, not-found guard, success (audited +
 *   event.deleted emitted)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { EventsService } from './events.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType, RsvpStatus } from '@alumini/types';

// ── Supabase mock (sequenced per table — see prior modules' specs for the same pattern) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order'].forEach((method) => {
    builder[method] = jest.fn(() => builder);
  });
  builder.single = jest.fn(() => Promise.resolve(next()));
  builder.maybeSingle = jest.fn(() => Promise.resolve(next()));
  builder.then = (resolve: any, reject: any) => Promise.resolve(next()).then(resolve, reject);
  return builder;
}

function mockTables(overrides: Record<string, ReturnType<typeof chain>>) {
  fromTables = overrides;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (table: string) => fromTables[table] ?? chain({ data: null, error: null }),
  })),
}));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

// ── Test suite ───────────────────────────────────────────────────────────────

describe('EventsService', () => {
  let service: EventsService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockEventEmit = jest.fn();

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        { provide: EventEmitter2, useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() } },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  // ── createEvent() ────────────────────────────────────────────────────────

  describe('createEvent()', () => {
    const dto = { title: 'Reunion', eventDate: future(30) };

    it('throws ForbiddenException for a non-verified member', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      await expect(service.createEvent('user-1', 'class-1', dto as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when event_date is not in the future', async () => {
      mockTables({ memberships: chain({ data: { id: 'm1' }, error: null }) });

      await expect(
        service.createEvent('user-1', 'class-1', { title: 'Old', eventDate: past(1) } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the event, audits it, and emits event.created for corridor', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({ data: { id: 'event-1', event_date: dto.eventDate }, error: null }),
      });

      const result = await service.createEvent('user-1', 'class-1', dto as any);

      expect(result.id).toBe('event-1');
      expect(mockEventEmit).toHaveBeenCalledWith(
        'event.created',
        expect.objectContaining({ eventId: 'event-1', classroomId: 'class-1', title: 'Reunion' }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.EVENT_CREATED }),
      );
    });
  });

  // ── listEvents() ─────────────────────────────────────────────────────────

  describe('listEvents()', () => {
    it('returns empty upcoming/past when there are no events', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({ data: [], error: null }),
      });

      const result = await service.listEvents('user-1', 'class-1');
      expect(result).toEqual({ upcoming: [], past: [] });
    });

    it('splits events into upcoming/past with RSVP counts and the caller’s own status', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({
          data: [
            { id: 'e1', classroom_id: 'class-1', event_date: future(5), title: 'Upcoming' },
            { id: 'e2', classroom_id: 'class-1', event_date: past(5), title: 'Past' },
          ],
          error: null,
        }),
        rsvps: chain({
          data: [
            { event_id: 'e1', user_id: 'user-1', status: RsvpStatus.GOING },
            { event_id: 'e1', user_id: 'other-user', status: RsvpStatus.MAYBE },
          ],
          error: null,
        }),
      });

      const result = await service.listEvents('user-1', 'class-1');

      expect(result.upcoming).toHaveLength(1);
      expect(result.upcoming[0].id).toBe('e1');
      expect(result.upcoming[0].rsvpCounts).toEqual({ going: 1, notGoing: 0, maybe: 1 });
      expect(result.upcoming[0].userRsvp).toBe(RsvpStatus.GOING);

      expect(result.past).toHaveLength(1);
      expect(result.past[0].id).toBe('e2');
      expect(result.past[0].rsvpCounts).toEqual({ going: 0, notGoing: 0, maybe: 0 });
      expect(result.past[0].userRsvp).toBeUndefined();
    });
  });

  // ── getEventDetail() ─────────────────────────────────────────────────────

  describe('getEventDetail()', () => {
    it('throws NotFoundException for a missing event', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({ data: null, error: null }),
      });

      await expect(service.getEventDetail('user-1', 'class-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('groups the RSVP list by status with names', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({ data: { id: 'e1', classroom_id: 'class-1', title: 'Reunion' }, error: null }),
        rsvps: chain({
          data: [
            { user_id: 'u1', status: RsvpStatus.GOING, profile: { id: 'u1', full_name: 'Priya Sharma', avatar_url: 'x' } },
            { user_id: 'u2', status: RsvpStatus.MAYBE, profile: { id: 'u2', full_name: 'Raj Kumar', avatar_url: null } },
          ],
          error: null,
        }),
      });

      const result = await service.getEventDetail('user-1', 'class-1', 'e1');

      expect(result.rsvps.going).toEqual([{ userId: 'u1', fullName: 'Priya Sharma', avatarUrl: 'x' }]);
      expect(result.rsvps.maybe).toEqual([{ userId: 'u2', fullName: 'Raj Kumar', avatarUrl: null }]);
      expect(result.rsvps.notGoing).toEqual([]);
    });
  });

  // ── upsertRsvp() / removeRsvp() ──────────────────────────────────────────

  describe('upsertRsvp()', () => {
    it('throws NotFoundException when the event is not in this classroom', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({ data: null, error: null }),
      });

      await expect(
        service.upsertRsvp('user-1', 'class-1', 'missing-event', { status: RsvpStatus.GOING } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('upserts the RSVP', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({ data: { id: 'e1' }, error: null }),
        rsvps: chain({ data: { id: 'r1', status: RsvpStatus.GOING }, error: null }),
      });

      const result = await service.upsertRsvp('user-1', 'class-1', 'e1', { status: RsvpStatus.GOING } as any);
      expect(result.status).toBe(RsvpStatus.GOING);
    });
  });

  describe('removeRsvp()', () => {
    it('throws NotFoundException when there is no existing RSVP', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({ data: { id: 'e1' }, error: null }),
        rsvps: chain({ data: null, error: null }),
      });

      await expect(service.removeRsvp('user-1', 'class-1', 'e1')).rejects.toThrow(NotFoundException);
    });

    it('removes an existing RSVP', async () => {
      mockTables({
        memberships: chain({ data: { id: 'm1' }, error: null }),
        events: chain({ data: { id: 'e1' }, error: null }),
        rsvps: chain({ data: { id: 'r1' }, error: null }, { data: null, error: null }),
      });

      await expect(service.removeRsvp('user-1', 'class-1', 'e1')).resolves.not.toThrow();
    });
  });

  // ── deleteEvent() ────────────────────────────────────────────────────────

  describe('deleteEvent()', () => {
    it('throws ForbiddenException when the caller is not a verified admin', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      await expect(service.deleteEvent('user-1', 'class-1', 'e1')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the event is not in this classroom', async () => {
      mockTables({
        memberships: chain({ data: { id: 'admin-m' }, error: null }),
        events: chain({ data: null, error: null }),
      });

      await expect(service.deleteEvent('admin-1', 'class-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('deletes the event, audits it, and emits event.deleted', async () => {
      mockTables({
        memberships: chain({ data: { id: 'admin-m' }, error: null }),
        events: chain({ data: { id: 'e1' }, error: null }, { data: null, error: null }),
      });

      await service.deleteEvent('admin-1', 'class-1', 'e1');

      expect(mockEventEmit).toHaveBeenCalledWith(
        'event.deleted',
        expect.objectContaining({ eventId: 'e1', classroomId: 'class-1' }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.EVENT_DELETED }),
      );
    });
  });
});
