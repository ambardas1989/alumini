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
  /** Raw status — needed alongside isVerified because 'pending_auto' gets classroom/student_alley access but isn't "verified" for display purposes (see canAccessChannel() in page.tsx). */
  verificationStatus: string | null;
  userRole: string | null;
  /** TASKS_08 TASK 06 — drives the "You joined this classroom on [date]" pill. */
  joinedAt: string | null;
}
