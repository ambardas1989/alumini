/**
 * Unit tests for CorridorService.
 *
 * Covers:
 * - getMessages(): full access returns real content; no access on
 *   staff_room/student_alley is a hard 403; no access on 'classroom' for a
 *   non-member is a hard 403; no access on 'classroom' for a member falls
 *   back to redacted content (server-side, via redactName() and
 *   REDACTED_CONTENT_PLACEHOLDER); a deleted message tombstones for
 *   EVERY viewer regardless of redaction status
 * - sendMessage(): channel-access gate enforced, messageType defaults to
 *   text, corridor.message.sent emitted
 * - deleteMessage(): not-found/already-deleted guards, own-message rule,
 *   admin-only-for-others rule, soft delete + audit
 * - system message / event card listeners: classroom.created,
 *   verification.approved, event.created
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { CorridorService } from './corridor.service';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../common/logger/logger.service';
import { MembershipService } from '../membership/membership.service';
import { AuditEventType, ChannelType, ErrorCode, MessageType } from '@alumini/types';
import { appConfig } from '@alumini/config/app';
import { redactName } from '@alumini/utils';

// ── Supabase mock (sequenced per table — see prior modules' specs for the same pattern) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'eq', 'order', 'range'].forEach((method) => {
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

// ── Test suite ───────────────────────────────────────────────────────────────

const mockAppLogger = { setContext: jest.fn().mockReturnThis(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('CorridorService', () => {
  let service: CorridorService;
  const mockAuditLog = jest.fn().mockResolvedValue(undefined);
  const mockEventEmit = jest.fn();
  const mockCanAccessChannel = jest.fn();

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorridorService,
        { provide: AuditService, useValue: { log: mockAuditLog } },
        { provide: EventEmitter2, useValue: { emit: mockEventEmit, on: jest.fn(), off: jest.fn() } },
        { provide: MembershipService, useValue: { canAccessChannel: mockCanAccessChannel } },
        { provide: AppLogger, useValue: mockAppLogger },
      ],
    }).compile();

    service = module.get<CorridorService>(CorridorService);
  });

  // ── getMessages() ────────────────────────────────────────────────────────

  describe('getMessages()', () => {
    const rawMessage = {
      id: 'msg-1',
      classroom_id: 'class-1',
      channel: ChannelType.CLASSROOM,
      sender_id: 'user-2',
      content: 'Hello everyone',
      message_type: 'text',
      metadata: null,
      is_deleted: false,
      deleted_by: null,
      deleted_at: null,
      created_at: '2024-01-01T00:00:00Z',
      sender: { id: 'user-2', full_name: 'Priya Sharma', avatar_url: 'https://x/y.png' },
    };

    it('returns real content and sender for a verified member on the classroom channel', async () => {
      mockTables({
        memberships: chain({ data: { role: 'student', verification_status: 'verified' }, error: null }),
        messages: chain({ data: [rawMessage], error: null }),
      });

      const result = await service.getMessages('user-1', 'class-1', ChannelType.CLASSROOM);

      expect(result[0].content).toBe('Hello everyone');
      expect(result[0].sender).toEqual({ id: 'user-2', fullName: 'Priya Sharma', avatarUrl: 'https://x/y.png' });
    });

    it('throws ForbiddenException on the classroom channel for a non-member', async () => {
      mockTables({ memberships: chain({ data: null, error: null }) });

      await expect(
        service.getMessages('outsider', 'class-1', ChannelType.CLASSROOM),
      ).rejects.toThrow(ForbiddenException);
    });

    it('redacts content and sender for an unverified member on the classroom channel', async () => {
      mockTables({
        memberships: chain({ data: { role: 'student', verification_status: 'pending' }, error: null }),
        messages: chain({ data: [rawMessage], error: null }),
      });

      const result = await service.getMessages('user-1', 'class-1', ChannelType.CLASSROOM);

      expect(result[0].content).toBe(appConfig.REDACTED_CONTENT_PLACEHOLDER);
      expect(result[0].sender?.fullName).toBe(redactName('Priya Sharma'));
      expect(result[0].sender?.avatarUrl).toBeNull();
      expect((result[0] as any).isRedacted).toBe(true);
    });

    // FIX 1 — staff_room is now a hard lock for students, symmetric with
    // student_alley's own hard lock for teachers/admins below. Reversed
    // from an earlier design that let students read staff_room.
    it('throws ForbiddenException for staff_room when the member is a verified student — hard lock, not a degraded view', async () => {
      mockTables({ memberships: chain({ data: { role: 'student', verification_status: 'verified' }, error: null }) });

      await expect(
        service.getMessages('user-1', 'class-1', ChannelType.STAFF_ROOM),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a verified teacher READ staff_room', async () => {
      mockTables({
        memberships: chain({ data: { role: 'teacher', verification_status: 'verified' }, error: null }),
        messages: chain({ data: [rawMessage], error: null }),
      });

      const result = await service.getMessages('user-1', 'class-1', ChannelType.STAFF_ROOM);
      expect(result[0].content).toBe('Hello everyone');
    });

    it('lets a verified admin READ staff_room', async () => {
      mockTables({
        memberships: chain({ data: { role: 'admin', verification_status: 'verified' }, error: null }),
        messages: chain({ data: [rawMessage], error: null }),
      });

      const result = await service.getMessages('user-1', 'class-1', ChannelType.STAFF_ROOM);
      expect(result[0].content).toBe('Hello everyone');
    });

    it('throws ForbiddenException for staff_room when the member is unverified — no degraded mode there', async () => {
      mockTables({ memberships: chain({ data: { role: 'teacher', verification_status: 'pending' }, error: null }) });

      await expect(
        service.getMessages('user-1', 'class-1', ChannelType.STAFF_ROOM),
      ).rejects.toThrow(ForbiddenException);
    });

    // TASKS_03 TASK 04 — student_alley: students read+post; teachers/admins
    // get NO read access at all (a hard lock, not just a posting
    // restriction — this channel is private to students).
    it('lets a verified student READ student_alley', async () => {
      mockTables({
        memberships: chain({ data: { role: 'student', verification_status: 'verified' }, error: null }),
        messages: chain({ data: [rawMessage], error: null }),
      });

      const result = await service.getMessages('user-1', 'class-1', ChannelType.STUDENT_ALLEY);
      expect(result[0].content).toBe('Hello everyone');
    });

    it('throws ForbiddenException for student_alley when the member is a verified teacher — hard lock, not redacted', async () => {
      mockTables({ memberships: chain({ data: { role: 'teacher', verification_status: 'verified' }, error: null }) });

      await expect(
        service.getMessages('user-1', 'class-1', ChannelType.STUDENT_ALLEY),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for student_alley when the member is a verified admin', async () => {
      mockTables({ memberships: chain({ data: { role: 'admin', verification_status: 'verified' }, error: null }) });

      await expect(
        service.getMessages('user-1', 'class-1', ChannelType.STUDENT_ALLEY),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets all verified/pending_auto members access the classroom channel regardless of role', async () => {
      mockTables({
        memberships: chain({ data: { role: 'admin', verification_status: 'pending_auto' }, error: null }),
        messages: chain({ data: [rawMessage], error: null }),
      });

      const result = await service.getMessages('user-1', 'class-1', ChannelType.CLASSROOM);
      expect(result[0].content).toBe('Hello everyone');
    });

    it('tombstones a deleted message even for a fully-verified viewer', async () => {
      mockTables({
        memberships: chain({ data: { role: 'student', verification_status: 'verified' }, error: null }),
        messages: chain({
          data: [{ ...rawMessage, is_deleted: true, deleted_at: '2024-02-01T00:00:00Z', content: 'never seen' }],
          error: null,
        }),
      });

      const result = await service.getMessages('user-1', 'class-1', ChannelType.CLASSROOM);

      expect(result[0].content).toBeNull();
      expect(result[0].sender).toBeNull();
      expect(result[0].isDeleted).toBe(true);
    });

    it('tombstones a deleted message for a redacted (unverified) viewer too', async () => {
      mockTables({
        memberships: chain({ data: { role: 'student', verification_status: 'pending' }, error: null }),
        messages: chain({
          data: [{ ...rawMessage, is_deleted: true, deleted_at: '2024-02-01T00:00:00Z' }],
          error: null,
        }),
      });

      const result = await service.getMessages('user-1', 'class-1', ChannelType.CLASSROOM);

      expect(result[0].content).toBeNull();
      expect(result[0].sender).toBeNull();
    });

    it('throws a BadRequestException carrying a recognisable ErrorCode when the query itself fails (FIX 1 regression)', async () => {
      mockTables({
        memberships: chain({ data: { role: 'student', verification_status: 'verified' }, error: null }),
        messages: chain({ data: null, error: { message: 'relationship ambiguous' } }),
      });

      let caught: BadRequestException | undefined;
      try {
        await service.getMessages('user-1', 'class-1', ChannelType.CLASSROOM);
      } catch (err) {
        caught = err as BadRequestException;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught!.getResponse()).toMatchObject({ error: ErrorCode.MESSAGES_LOAD_FAILED });
    });
  });

  // ── sendMessage() ────────────────────────────────────────────────────────

  describe('sendMessage()', () => {
    it('throws ForbiddenException when canAccessChannel is false', async () => {
      mockCanAccessChannel.mockResolvedValue(false);

      await expect(
        service.sendMessage('user-1', 'class-1', ChannelType.STUDENT_ALLEY, { content: 'hi' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('inserts with message_type defaulted to text and emits corridor.message.sent', async () => {
      mockCanAccessChannel.mockResolvedValue(true);
      const messagesChain = chain({ data: { id: 'msg-1', content: 'hi', message_type: 'text' }, error: null });
      mockTables({ messages: messagesChain });

      const result = await service.sendMessage('user-1', 'class-1', ChannelType.CLASSROOM, { content: 'hi' } as any);

      expect(result.id).toBe('msg-1');
      expect(messagesChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ sender_id: 'user-1', message_type: MessageType.TEXT, content: 'hi' }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith(
        'corridor.message.sent',
        expect.objectContaining({ messageId: 'msg-1', classroomId: 'class-1', senderId: 'user-1' }),
      );
    });
  });

  // ── deleteMessage() ──────────────────────────────────────────────────────

  describe('deleteMessage()', () => {
    it('throws NotFoundException for a missing message', async () => {
      mockTables({ messages: chain({ data: null, error: null }) });

      await expect(service.deleteMessage('user-1', 'class-1', 'msg-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when already deleted', async () => {
      mockTables({
        messages: chain({ data: { id: 'msg-1', sender_id: 'user-1', is_deleted: true }, error: null }),
      });

      await expect(service.deleteMessage('user-1', 'class-1', 'msg-1')).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException deleting your own message if no longer a verified member', async () => {
      mockTables({
        messages: chain({ data: { id: 'msg-1', sender_id: 'user-1', is_deleted: false }, error: null }),
        memberships: chain({ data: { verification_status: 'pending' }, error: null }),
      });

      await expect(service.deleteMessage('user-1', 'class-1', 'msg-1')).rejects.toThrow(ForbiddenException);
    });

    it('allows a verified sender to delete their own message and audits own_message=true', async () => {
      mockTables({
        messages: chain(
          { data: { id: 'msg-1', sender_id: 'user-1', is_deleted: false }, error: null },
          { data: null, error: null }, // update
        ),
        memberships: chain({ data: { verification_status: 'verified' }, error: null }),
      });

      await service.deleteMessage('user-1', 'class-1', 'msg-1');

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.MESSAGE_DELETED,
          metadata: expect.objectContaining({ own_message: true }),
        }),
      );
    });

    it("throws ForbiddenException for a non-sender who isn't a verified classroom admin", async () => {
      mockTables({
        messages: chain({ data: { id: 'msg-1', sender_id: 'other-user', is_deleted: false }, error: null }),
        memberships: chain({ data: null, error: null }), // not an admin
      });

      await expect(service.deleteMessage('user-1', 'class-1', 'msg-1')).rejects.toThrow(ForbiddenException);
    });

    it('allows a verified classroom admin to delete any message and audits own_message=false', async () => {
      mockTables({
        messages: chain(
          { data: { id: 'msg-1', sender_id: 'other-user', is_deleted: false }, error: null },
          { data: null, error: null },
        ),
        memberships: chain({ data: { id: 'admin-membership' }, error: null }),
      });

      await service.deleteMessage('admin-1', 'class-1', 'msg-1');

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.MESSAGE_DELETED,
          metadata: expect.objectContaining({ own_message: false, original_sender_id: 'other-user' }),
        }),
      );
    });
  });

  // ── Event listeners ──────────────────────────────────────────────────────

  describe('handleClassroomCreated()', () => {
    it('posts a system welcome message to the classroom channel', async () => {
      const messagesChain = chain({ data: null, error: null });
      mockTables({ messages: messagesChain });

      await service.handleClassroomCreated({ classroomId: 'class-1', creatorId: 'user-1', globalId: 'IN-KOL-X-9A-2012' });

      expect(messagesChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          classroom_id: 'class-1',
          channel: ChannelType.CLASSROOM,
          sender_id: null,
          message_type: MessageType.SYSTEM,
        }),
      );
    });
  });

  describe('handleVerificationApproved()', () => {
    it('posts a system announcement with the method in metadata', async () => {
      const messagesChain = chain({ data: null, error: null });
      mockTables({ messages: messagesChain });

      await service.handleVerificationApproved({ userId: 'user-1', classroomId: 'class-1', method: 'email' });

      expect(messagesChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          message_type: MessageType.SYSTEM,
          metadata: expect.objectContaining({ event: 'verification.approved', method: 'email' }),
        }),
      );
    });
  });

  describe('handleEventCreated()', () => {
    it('posts an event_card with event_id in metadata for RSVP rendering', async () => {
      const messagesChain = chain({ data: null, error: null });
      mockTables({ messages: messagesChain });

      await service.handleEventCreated({ eventId: 'event-1', classroomId: 'class-1', title: 'Reunion 2026' });

      expect(messagesChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          message_type: MessageType.EVENT_CARD,
          content: 'Reunion 2026',
          metadata: { event_id: 'event-1' },
        }),
      );
    });
  });
});
