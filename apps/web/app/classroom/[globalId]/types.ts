import type { ChannelType, MessageType } from '@alumini/types';

/**
 * One chat message as rendered on screen. Extends the server shape with
 * client-only optimistic-send bookkeeping (`clientStatus`/`clientId`) —
 * see MessageInput.tsx / the page's handleSend().
 */
export interface UiMessage {
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
  isRedacted?: boolean;
  /** Present only for a message this client just sent, before/if it fails to confirm. */
  clientStatus?: 'sending' | 'failed';
  /** The optimistic id assigned before the server responds — kept so a retry re-uses the same list slot. */
  clientId?: string;
}

export interface MembershipInfo {
  isMember: boolean;
  isVerified: boolean;
  userRole: string | null;
}
