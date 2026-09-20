/**
 * Unit tests for DmService.
 *
 * Covers:
 * - getConversations(): groups rows by counterparty, correct shape (user,
 *   lastMessage, unreadCount), most-recent-first
 * - getMessages(): throws ForbiddenException with no shared verified
 *   classroom
 * - sendMessage(): validates content length (empty, over 2000 chars);
 *   throws ForbiddenException with no shared verified classroom
 */

import { Test, TestingModule } from '@nestjs/testing';

import { DmService } from './dm.service';

// ── Supabase mock (sequenced per table — same pattern as corridor.service.spec.ts) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'eq', 'order', 'range', 'or', 'in'].forEach((method) => {
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

describe('DmService', () => {
  let service: DmService;

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    mockTables({});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [DmService],
    }).compile();

    service = module.get<DmService>(DmService);
  });

  // ── getConversations() ─────────────────────────────────────────────────

  describe('getConversations()', () => {
    it('groups messages by counterparty and returns the correct shape, most recent first', async () => {
      const rows = [
        {
          id: 'm3',
          sender_id: 'other-2',
          recipient_id: 'me',
          content: 'hey again',
          is_read: false,
          is_deleted: false,
          created_at: '2026-09-20T10:00:00Z',
        },
        {
          id: 'm2',
          sender_id: 'me',
          recipient_id: 'other-1',
          content: 'yo',
          is_read: true,
          is_deleted: false,
          created_at: '2026-09-19T10:00:00Z',
        },
        {
          id: 'm1',
          sender_id: 'other-1',
          recipient_id: 'me',
          content: 'hi',
          is_read: false,
          is_deleted: false,
          created_at: '2026-09-18T10:00:00Z',
        },
      ];

      mockTables({
        direct_messages: chain({ data: rows, error: null }),
        profiles: chain({
          data: [
            { id: 'other-1', full_name: 'Alice', avatar_url: null },
            { id: 'other-2', full_name: 'Bob', avatar_url: null },
          ],
          error: null,
        }),
      });

      const result = await service.getConversations('me');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        user: { id: 'other-2', fullName: 'Bob', avatarUrl: null },
        lastMessage: { content: 'hey again', createdAt: '2026-09-20T10:00:00Z', isOwn: false },
        unreadCount: 1,
      });
      expect(result[1]).toEqual({
        user: { id: 'other-1', fullName: 'Alice', avatarUrl: null },
        lastMessage: { content: 'yo', createdAt: '2026-09-19T10:00:00Z', isOwn: true },
        unreadCount: 1,
      });
    });

    it('returns an empty array when the user has no conversations', async () => {
      mockTables({ direct_messages: chain({ data: [], error: null }) });
      const result = await service.getConversations('me');
      expect(result).toEqual([]);
    });
  });

  // ── getMessages() ────────────────────────────────────────────────────────

  describe('getMessages()', () => {
    it('throws ForbiddenException when the two users share no verified classroom', async () => {
      mockTables({
        memberships: chain(
          { data: [{ classroom_id: 'class-1' }], error: null },
          { data: [{ classroom_id: 'class-2' }], error: null },
        ),
      });

      await expect(service.getMessages('me', 'other')).rejects.toThrow(
        'You can only message verified members of your classrooms',
      );
    });

    it('returns the thread, oldest first, when a shared verified classroom exists', async () => {
      mockTables({
        memberships: chain(
          { data: [{ classroom_id: 'class-1' }], error: null },
          { data: [{ classroom_id: 'class-1' }], error: null },
        ),
        direct_messages: chain({
          data: [
            { id: 'm2', sender_id: 'other', recipient_id: 'me', content: 'newer', is_read: true, is_deleted: false, created_at: '2026-09-20T10:00:00Z' },
            { id: 'm1', sender_id: 'me', recipient_id: 'other', content: 'older', is_read: true, is_deleted: false, created_at: '2026-09-19T10:00:00Z' },
          ],
          error: null,
        }),
      });

      const result = await service.getMessages('me', 'other');
      expect(result.map((m) => m.id)).toEqual(['m1', 'm2']);
    });
  });

  // ── sendMessage() ────────────────────────────────────────────────────────

  describe('sendMessage()', () => {
    const sharedClassroom = () =>
      chain(
        { data: [{ classroom_id: 'class-1' }], error: null },
        { data: [{ classroom_id: 'class-1' }], error: null },
      );

    it('throws ForbiddenException when the two users share no verified classroom', async () => {
      mockTables({
        memberships: chain(
          { data: [{ classroom_id: 'class-1' }], error: null },
          { data: [{ classroom_id: 'class-2' }], error: null },
        ),
      });

      await expect(service.sendMessage('me', 'other', 'hello')).rejects.toThrow(
        'You can only message verified members of your classrooms',
      );
    });

    it('rejects empty content', async () => {
      mockTables({ memberships: sharedClassroom() });
      await expect(service.sendMessage('me', 'other', '   ')).rejects.toThrow('Message cannot be empty');
    });

    it('rejects content over 2000 characters', async () => {
      mockTables({ memberships: sharedClassroom() });
      const tooLong = 'a'.repeat(2001);
      await expect(service.sendMessage('me', 'other', tooLong)).rejects.toThrow(
        'Message cannot exceed 2000 characters',
      );
    });

    it('creates the message when content and shared classroom are both valid', async () => {
      mockTables({
        memberships: sharedClassroom(),
        direct_messages: chain({
          data: {
            id: 'new-msg',
            sender_id: 'me',
            recipient_id: 'other',
            content: 'hello',
            is_read: false,
            created_at: '2026-09-20T10:00:00Z',
          },
          error: null,
        }),
      });

      const result = await service.sendMessage('me', 'other', 'hello');
      expect(result.id).toBe('new-msg');
      expect(result.content).toBe('hello');
    });
  });
});
