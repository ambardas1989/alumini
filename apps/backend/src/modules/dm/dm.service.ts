/**
 * DmService — 1:1 direct messages between verified members of a shared
 * classroom (TASKS_03.md TASK 06). No read receipts beyond `is_read`, no
 * typing indicators, no online status.
 *
 * ACCESS CONTROL: getMessages() and sendMessage() both require the two
 * users to share at least one classroom where BOTH have
 * verification_status = 'verified' — a plain 'pending'/'pending_auto'
 * membership does not qualify here, unlike corridor's classroom-channel
 * degraded-read mode. DMs are an explicit trust escalation (exchanging a
 * private channel), not a group-read fallback.
 */

import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { getRange } from '@alumini/utils';
import { AppLogger } from '../../common/logger/logger.service';

const DM_PAGE_SIZE = 50;

export interface DmConversation {
  user: { id: string; fullName: string | null; avatarUrl: string | null };
  lastMessage: { content: string | null; createdAt: string; isOwn: boolean };
  unreadCount: number;
}

export interface DmMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
}

@Injectable()
export class DmService {
  private readonly logger = new Logger(DmService.name);
  private readonly supabase: SupabaseClient;

  constructor(private readonly appLogger: AppLogger) {
    this.appLogger.setContext('DM');
    this.supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }

  /**
   * Unique conversations for `userId`, most recent message first. Fetches
   * every direct_message row involving this user once and groups it in
   * memory rather than issuing one query per counterparty — this table has
   * no fan-out concern (a user's own DM volume), so a single ordered scan
   * is simpler than a GROUP BY round trip per stat.
   */
  async getConversations(userId: string): Promise<DmConversation[]> {
    this.appLogger.debug('Fetch conversations', { userId });

    const { data: rows, error } = await this.supabase
      .from('direct_messages')
      .select('id, sender_id, recipient_id, content, is_read, is_deleted, created_at')
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) {
      this.appLogger.error('Fetch failed', { userId, error: error.message });
      this.logger.error('Failed to load conversations', { error, userId });
      throw new BadRequestException('Failed to load conversations');
    }

    const lastMessageByParty = new Map<string, (typeof rows)[number]>();
    const unreadCountByParty = new Map<string, number>();

    for (const row of rows ?? []) {
      const otherId = row.sender_id === userId ? row.recipient_id : row.sender_id;
      if (!lastMessageByParty.has(otherId)) {
        lastMessageByParty.set(otherId, row);
      }
      if (row.recipient_id === userId && !row.is_read) {
        unreadCountByParty.set(otherId, (unreadCountByParty.get(otherId) ?? 0) + 1);
      }
    }

    const otherIds = Array.from(lastMessageByParty.keys());
    if (otherIds.length === 0) return [];

    const { data: profiles } = await this.supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', otherIds);

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    // Map insertion order already mirrors the descending-by-time scan above
    // (first row seen per counterparty is that counterparty's most recent
    // message), so `otherIds` is already sorted most-recent-first.
    return otherIds.map((otherId) => {
      const last = lastMessageByParty.get(otherId)!;
      const profile = profileById.get(otherId);
      return {
        user: {
          id: otherId,
          fullName: profile?.full_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
        },
        lastMessage: {
          content: last.is_deleted ? null : last.content,
          createdAt: last.created_at,
          isOwn: last.sender_id === userId,
        },
        unreadCount: unreadCountByParty.get(otherId) ?? 0,
      };
    });
  }

  /**
   * Paginated thread between userId and otherUserId, oldest first. Page 0
   * is the most recent DM_PAGE_SIZE messages (queried descending, matching
   * "scroll to bottom on load"), reversed before returning so the array
   * itself is oldest-first — ready to render top-to-bottom without the
   * caller re-sorting.
   */
  async getMessages(userId: string, otherUserId: string, page = 0): Promise<DmMessage[]> {
    await this.assertSharedVerifiedClassroom(userId, otherUserId);

    const { from, to } = getRange(page, DM_PAGE_SIZE);

    const { data, error } = await this.supabase
      .from('direct_messages')
      .select('id, sender_id, recipient_id, content, is_read, is_deleted, created_at')
      .or(
        `and(sender_id.eq.${userId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${userId})`,
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error('Failed to load DM thread', { error, userId, otherUserId });
      throw new BadRequestException('Failed to load messages');
    }

    return (data ?? []).reverse().map((m) => this.present(m));
  }

  /** senderId is always the caller — recipientId is the :userId route param. */
  async sendMessage(senderId: string, recipientId: string, content: string): Promise<DmMessage> {
    await this.assertSharedVerifiedClassroom(senderId, recipientId);

    const trimmed = content?.trim() ?? '';
    if (!trimmed) {
      throw new BadRequestException('Message cannot be empty');
    }
    if (trimmed.length > 2000) {
      throw new BadRequestException('Message cannot exceed 2000 characters');
    }

    const { data: message, error } = await this.supabase
      .from('direct_messages')
      .insert({ sender_id: senderId, recipient_id: recipientId, content: trimmed })
      .select()
      .single();

    if (error || !message) {
      this.appLogger.error('Send failed', { error: error?.message });
      this.logger.error('Failed to send DM', { error, senderId, recipientId });
      throw new BadRequestException('Failed to send message. Please try again.');
    }

    this.appLogger.info('Message sent', { senderId, recipientId });
    return this.present(message);
  }

  /** Marks every unread message FROM otherUserId TO userId as read. */
  async markRead(userId: string, otherUserId: string): Promise<void> {
    const { error } = await this.supabase
      .from('direct_messages')
      .update({ is_read: true })
      .eq('sender_id', otherUserId)
      .eq('recipient_id', userId)
      .eq('is_read', false);

    if (error) {
      this.logger.error('Failed to mark DMs read', { error, userId, otherUserId });
      throw new BadRequestException('Failed to mark messages as read');
    }
  }

  /**
   * Shared gate for getMessages()/sendMessage(): both users must be a
   * VERIFIED member (not pending/pending_auto/rejected) of at least one
   * common classroom.
   */
  private async assertSharedVerifiedClassroom(userId: string, otherUserId: string): Promise<void> {
    const [{ data: mineRows }, { data: theirRows }] = await Promise.all([
      this.supabase.from('memberships').select('classroom_id').eq('user_id', userId).eq('verification_status', 'verified'),
      this.supabase
        .from('memberships')
        .select('classroom_id')
        .eq('user_id', otherUserId)
        .eq('verification_status', 'verified'),
    ]);

    const mineSet = new Set((mineRows ?? []).map((r) => r.classroom_id));
    const shared = (theirRows ?? []).some((r) => mineSet.has(r.classroom_id));

    if (!shared) {
      this.appLogger.warn('Access denied - no shared classroom', { senderId: userId, recipientId: otherUserId });
      throw new ForbiddenException('You can only message verified members of your classrooms');
    }
  }

  private present(m: any): DmMessage {
    return {
      id: m.id,
      senderId: m.sender_id,
      recipientId: m.recipient_id,
      content: m.content,
      isRead: m.is_read,
      createdAt: m.created_at,
    };
  }
}
