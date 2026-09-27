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
  private readonly appLogger: AppLogger;

  constructor(appLogger: AppLogger) {
    this.appLogger = appLogger.setContext('DM');
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
    this.appLogger.debug('[DM:conversations] entry', { userId });

    const { data: rows, error } = await this.supabase
      .from('direct_messages')
      .select('id, sender_id, recipient_id, content, is_read, is_deleted, created_at')
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    this.appLogger.debug('[DM:conversations] result', { count: rows?.length, error: error?.message, code: error?.code });

    if (error) {
      this.appLogger.error('[DM:conversations] failed', {
        userId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
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
    if (otherIds.length === 0) {
      this.appLogger.info('[DM:conversations] success', { userId, count: 0 });
      return [];
    }

    const { data: profiles } = await this.supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', otherIds);

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    // Map insertion order already mirrors the descending-by-time scan above
    // (first row seen per counterparty is that counterparty's most recent
    // message), so `otherIds` is already sorted most-recent-first.
    this.appLogger.info('[DM:conversations] success', { userId, count: otherIds.length });
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
   * TASKS_09 TASK 04 — "New conversation" search: verified members of the
   * caller's own verified classrooms, matched by name. Aggregated in
   * application code rather than a filtered join — PostgREST's embed
   * filters (`.ilike('profile.full_name', ...)`) aren't reliably
   * supported by this codebase's supabase-js version, and classroom
   * membership counts are modest enough at this scale (same "aggregate in
   * JS" reasoning EventsService.listEvents()'s own RSVP aggregation
   * already documents).
   */
  async searchRecipients(userId: string, q: string): Promise<
    Array<{ userId: string; fullName: string | null; avatarUrl: string | null; sharedClassroomName: string | null }>
  > {
    this.appLogger.debug('[DM:search] entry', { userId, q });

    const trimmed = q.trim();
    if (trimmed.length < 2) return [];

    const { data: mine } = await this.supabase
      .from('memberships')
      .select('classroom_id, classroom:classrooms(name)')
      .eq('user_id', userId)
      .eq('verification_status', 'verified');

    const myClassroomIds = Array.from(new Set((mine ?? []).map((m) => m.classroom_id)));
    if (myClassroomIds.length === 0) return [];

    const classroomNameById = new Map((mine ?? []).map((m: any) => [m.classroom_id, m.classroom?.name ?? null]));

    const { data: candidates, error } = await this.supabase
      .from('memberships')
      .select('user_id, classroom_id, profile:profiles(full_name, avatar_url)')
      .in('classroom_id', myClassroomIds)
      .eq('verification_status', 'verified')
      .neq('user_id', userId);

    if (error) {
      this.appLogger.error('[DM:search] failed', { userId, error: error.message, code: error.code });
      throw new BadRequestException('Failed to search classmates');
    }

    const lowerQ = trimmed.toLowerCase();
    const byUser = new Map<string, { userId: string; fullName: string; avatarUrl: string | null; classroomId: string }>();

    for (const row of candidates ?? []) {
      const fullName = (row.profile as any)?.full_name ?? '';
      if (!fullName.toLowerCase().includes(lowerQ)) continue;
      if (byUser.has(row.user_id)) continue;
      byUser.set(row.user_id, {
        userId: row.user_id,
        fullName,
        avatarUrl: (row.profile as any)?.avatar_url ?? null,
        classroomId: row.classroom_id,
      });
    }

    const results = Array.from(byUser.values())
      .slice(0, 10)
      .map((r) => ({
        userId: r.userId,
        fullName: r.fullName,
        avatarUrl: r.avatarUrl,
        sharedClassroomName: classroomNameById.get(r.classroomId) ?? null,
      }));

    this.appLogger.debug('[DM:search] result', { count: results.length });
    return results;
  }

  /**
   * Paginated thread between userId and otherUserId, oldest first. Page 0
   * is the most recent DM_PAGE_SIZE messages (queried descending, matching
   * "scroll to bottom on load"), reversed before returning so the array
   * itself is oldest-first — ready to render top-to-bottom without the
   * caller re-sorting.
   */
  async getMessages(userId: string, otherUserId: string, page = 0): Promise<DmMessage[]> {
    this.appLogger.debug('[DM:messages] entry', { userId, otherUserId, page });

    let hasShared = true;
    try {
      await this.assertSharedVerifiedClassroom(userId, otherUserId);
    } catch (e) {
      hasShared = false;
      throw e;
    } finally {
      this.appLogger.debug('[DM:messages] shared classroom check', { hasShared });
    }

    const { from, to } = getRange(page, DM_PAGE_SIZE);

    const { data, error } = await this.supabase
      .from('direct_messages')
      .select('id, sender_id, recipient_id, content, is_read, is_deleted, created_at')
      .or(
        `and(sender_id.eq.${userId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${userId})`,
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    this.appLogger.debug('[DM:messages] result', { count: data?.length, error: error?.message });

    if (error) {
      this.appLogger.error('[DM:messages] failed', {
        userId,
        otherUserId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to load messages');
    }

    this.appLogger.info('[DM:messages] success', { userId, otherUserId, count: data?.length ?? 0 });
    return (data ?? []).reverse().map((m) => this.present(m));
  }

  /** senderId is always the caller — recipientId is the :userId route param. */
  async sendMessage(senderId: string, recipientId: string, content: string): Promise<DmMessage> {
    this.appLogger.debug('[DM:send] entry', { senderId, recipientId, contentLength: content?.length });

    let hasShared = true;
    try {
      await this.assertSharedVerifiedClassroom(senderId, recipientId);
    } catch (e) {
      hasShared = false;
      throw e;
    } finally {
      this.appLogger.debug('[DM:send] shared classroom check', { hasShared });
    }

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

    this.appLogger.debug('[DM:send] insert result', { success: !error && !!message, messageId: message?.id });

    if (error || !message) {
      this.appLogger.error('[DM:send] failed', {
        senderId,
        recipientId,
        error: error?.message,
        code: error?.code,
        hint: error?.hint,
        details: error?.details,
      });
      throw new BadRequestException('Failed to send message. Please try again.');
    }

    this.appLogger.info('[DM:send] success', { senderId, recipientId, messageId: message.id });
    return this.present(message);
  }

  /** Marks every unread message FROM otherUserId TO userId as read. */
  async markRead(userId: string, otherUserId: string): Promise<void> {
    this.appLogger.debug('[DM:markRead] entry', { userId, otherUserId });

    const { error } = await this.supabase
      .from('direct_messages')
      .update({ is_read: true })
      .eq('sender_id', otherUserId)
      .eq('recipient_id', userId)
      .eq('is_read', false);

    this.appLogger.debug('[DM:markRead] result', { success: !error });

    if (error) {
      this.appLogger.error('[DM:markRead] failed', {
        userId,
        otherUserId,
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      });
      throw new BadRequestException('Failed to mark messages as read');
    }
  }

  /**
   * Shared gate for getMessages()/sendMessage(): both users must be a
   * VERIFIED member (not pending/pending_auto/rejected) of at least one
   * common classroom.
   */
  private async assertSharedVerifiedClassroom(userId: string, otherUserId: string): Promise<void> {
    this.appLogger.debug('[DM:sharedClassroom] entry', { userId, otherUserId });

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
      this.appLogger.warn('[DM:sharedClassroom] no shared classroom', { userId, otherUserId });
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
