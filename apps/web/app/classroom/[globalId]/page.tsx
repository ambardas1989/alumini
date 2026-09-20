'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChannelType, MessageType } from '@alumini/types';
import type { Classroom, Event as ClassroomEvent, Institution, Message, RedactedMessage, RsvpStatus } from '@alumini/types';
import * as api from '@/lib/api';
import type { ClassroomMember } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { Modal } from '@/components/ui/Modal';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ClassroomHeader } from './ClassroomHeader';
import { ChannelTabs } from './ChannelTabs';
import { LockedChannel } from './LockedChannel';
import { MessageBubble } from './MessageBubble';
import { EventMessageCard } from './EventMessageCard';
import { MessageInput } from './MessageInput';
import { ClassInfoSheet } from './ClassInfoSheet';
import { EventCreateModal } from './EventCreateModal';
import { MemberListModal } from './MemberListModal';
import type { MembershipInfo, UiMessage } from './types';
import styles from './page.module.css';

const POLL_INTERVAL_MS = 5000;
const SCROLL_BOTTOM_THRESHOLD_PX = 60;
const MEMBER_STATS_MAX_PAGES = 8; // caps at 200 members — see loadMemberStats()'s own comment

type ClassroomDetail = Classroom & { institution: Institution };

function toUiMessage(m: Message | RedactedMessage, classroomId: string, channel: ChannelType): UiMessage {
  const anyM = m as Message & Partial<RedactedMessage>;
  return {
    id: anyM.id,
    classroomId,
    channel,
    messageType: anyM.messageType,
    metadata: anyM.metadata ?? null,
    isDeleted: anyM.isDeleted,
    deletedAt: anyM.deletedAt ?? null,
    createdAt: anyM.createdAt,
    content: anyM.content,
    sender: anyM.sender
      ? { id: anyM.sender.id, fullName: anyM.sender.fullName, avatarUrl: anyM.sender.avatarUrl ?? null }
      : null,
    isRedacted: 'isRedacted' in anyM ? anyM.isRedacted : undefined,
  };
}

/** Backend returns newest-first; the UI renders oldest-at-top like a normal chat log. */
function toAscending(data: Array<Message | RedactedMessage>, classroomId: string, channel: ChannelType): UiMessage[] {
  return [...data].reverse().map((m) => toUiMessage(m, classroomId, channel));
}

function canAccessChannel(role: string | null, verificationStatus: string | null, channel: ChannelType): boolean {
  // pending_auto gets full classroom/student_alley access (early-joiner cold-start fix) but
  // not staff_room — mirrors MembershipService.canAccessChannel() on the backend.
  const hasFullAccess = verificationStatus === 'verified' || verificationStatus === 'pending_auto';
  if (channel === ChannelType.CLASSROOM) return true; // unverified gets the degraded/redacted view, not a lock
  if (channel === ChannelType.STAFF_ROOM) return verificationStatus === 'verified' && (role === 'teacher' || role === 'admin');
  if (channel === ChannelType.STUDENT_ALLEY) return hasFullAccess && (role === 'student' || role === 'admin');
  return false;
}

export default function ClassroomPage() {
  const params = useParams<{ globalId: string }>();
  const globalId = params.globalId;
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { showToast } = useToast();
  const t = useTranslations('classroom');
  const tCommon = useTranslations('common');
  const tMembership = useTranslations('membership');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [membership, setMembership] = useState<MembershipInfo>({
    isMember: false,
    isVerified: false,
    verificationStatus: null,
    userRole: null,
  });
  const [joining, setJoining] = useState(false);

  const [activeChannel, setActiveChannel] = useState<ChannelType>(ChannelType.CLASSROOM);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const messagesRef = useRef<UiMessage[]>([]);
  messagesRef.current = messages;

  const [events, setEvents] = useState<Record<string, ClassroomEvent>>({});
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  // Read inside pollOnce() instead of the state above — pollOnce must stay
  // referentially stable across scroll events, or the interval effect below
  // (which depends on it) tears down and restarts setInterval on every
  // scroll, delaying/jittering the actual 5s poll cadence.
  const isScrolledToBottomRef = useRef(true);
  isScrolledToBottomRef.current = isScrolledToBottom;
  const [newMessageCount, setNewMessageCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const [members, setMembers] = useState<ClassroomMember[]>([]);
  const [memberStats, setMemberStats] = useState({ teacherCount: 0, verifiedCount: 0 });

  const [showInfoSheet, setShowInfoSheet] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [earlyMemberBannerDismissed, setEarlyMemberBannerDismissed] = useState(false);

  // ── Load classroom + membership ─────────────────────────────────────────
  //
  // No GET /membership/:classroomId endpoint exists on the backend — the
  // task's own spec assumed one, but MembershipService has no public
  // controller. getMyClassrooms() already carries per-classroom
  // verificationStatus/userRole for every classroom the caller belongs to,
  // so membership is derived by matching this classroom's globalId there
  // instead: present in that list = member, absent = not a member.
  const loadClassroomAndMembership = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [classroomData, myClassrooms] = await Promise.all([
        api.getClassroom(globalId),
        api.getMyClassrooms(),
      ]);
      setClassroom(classroomData);
      const match = myClassrooms.flatMap((g) => g.classes).find((c) => c.globalId === globalId);
      setMembership({
        isMember: !!match,
        isVerified: match?.verificationStatus === 'verified',
        verificationStatus: match?.verificationStatus ?? null,
        userRole: (match?.userRole as string | undefined) ?? null,
      });
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [globalId]);

  useEffect(() => {
    if (!ready) return;
    loadClassroomAndMembership();
  }, [ready, loadClassroomAndMembership]);

  const earlyMemberBannerKey = `alumini_early_member_banner_dismissed_${globalId}`;

  useEffect(() => {
    try {
      setEarlyMemberBannerDismissed(window.localStorage.getItem(earlyMemberBannerKey) === '1');
    } catch {
      // localStorage unavailable (private mode, etc.) — banner just stays visible.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalId]);

  const dismissEarlyMemberBanner = () => {
    setEarlyMemberBannerDismissed(true);
    try {
      window.localStorage.setItem(earlyMemberBannerKey, '1');
    } catch {
      // Best-effort — worst case it reappears next visit.
    }
  };

  const handleJoin = async () => {
    if (!classroom) return;
    setJoining(true);
    try {
      await api.joinClassroom(classroom.id);
      await loadClassroomAndMembership();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setJoining(false);
    }
  };

  // ── Member stats (for the header row) ───────────────────────────────────
  //
  // No aggregate "X teachers, X verified" endpoint exists either — computed
  // client-side from the paginated member list, capped at
  // MEMBER_STATS_MAX_PAGES (200 members) so a very large classroom doesn't
  // trigger unbounded fetching. Undercounts past that cap; documented
  // rather than silently wrong.
  const loadMemberStats = useCallback(async () => {
    if (!classroom) return;
    const all: ClassroomMember[] = [];
    for (let page = 0; page < MEMBER_STATS_MAX_PAGES; page++) {
      const batch = await api.getMembers(classroom.id, page);
      all.push(...batch);
      if (batch.length < 25) break;
    }
    setMembers(all);
    setMemberStats({
      teacherCount: all.filter((m) => m.role === 'teacher').length,
      verifiedCount: all.filter((m) => m.verificationStatus === 'verified').length,
    });
  }, [classroom]);

  useEffect(() => {
    if (!classroom || !membership.isMember) return;
    loadMemberStats().catch((err) => showToast(getErrorMessage(err), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom, membership.isMember]);

  // ── Events (for event_card lookups + info sheet upcoming list) ─────────
  const loadEvents = useCallback(async () => {
    if (!classroom) return;
    try {
      const { upcoming, past } = await api.getEvents(classroom.id);
      const map: Record<string, ClassroomEvent> = {};
      [...upcoming, ...past].forEach((e) => {
        map[e.id] = e;
      });
      setEvents(map);
    } catch {
      // Non-fatal — event_card messages fall back to their plain title (see EventMessageCard).
    }
  }, [classroom]);

  useEffect(() => {
    if (!classroom || !membership.isMember) return;
    loadEvents();
  }, [classroom, membership.isMember, loadEvents]);

  // ── Messages: load on channel switch, poll while active + verified ─────
  const canAccessActive = canAccessChannel(membership.userRole, membership.verificationStatus, activeChannel);

  const loadMessages = useCallback(async () => {
    if (!classroom) return;
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const data = await api.getMessages(classroom.id, activeChannel, 0);
      const ascending = toAscending(data, classroom.id, activeChannel);
      setMessages(ascending);
      setNewMessageCount(0);
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[CLASSROOM-ERROR] Failed to load messages', { classroomId: classroom.id, channel: activeChannel, err });
      setMessagesError(getErrorMessage(err));
    } finally {
      setMessagesLoading(false);
    }
  }, [classroom, activeChannel]);

  useEffect(() => {
    if (!classroom || !membership.isMember || !canAccessActive) return;
    setMessages([]);
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom, membership.isMember, activeChannel, canAccessActive]);

  const pollOnce = useCallback(async () => {
    if (!classroom) return;
    try {
      const data = await api.getMessages(classroom.id, activeChannel, 0);
      const fresh = toAscending(data, classroom.id, activeChannel);
      const knownIds = new Set(messagesRef.current.filter((m) => !m.clientId).map((m) => m.id));
      const newOnes = fresh.filter((m) => !knownIds.has(m.id));
      if (newOnes.length === 0) return;

      setMessages((prev) => [...prev, ...newOnes]);

      if (isScrolledToBottomRef.current) {
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      } else {
        setNewMessageCount((n) => n + newOnes.length);
      }

      // A new event_card message means a new event exists — refresh the map.
      if (newOnes.some((m) => m.messageType === MessageType.EVENT_CARD)) {
        loadEvents();
      }
    } catch (err) {
      // Silent to the UI — polling failures shouldn't interrupt the reading
      // experience with an error banner — but still logged for debugging.
      // eslint-disable-next-line no-console
      console.error('[CLASSROOM-ERROR] Poll failed', { classroomId: classroom.id, channel: activeChannel, err });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom, activeChannel]);

  useEffect(() => {
    if (!classroom || !membership.isMember || !canAccessActive) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(pollOnce, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [classroom, membership.isMember, activeChannel, canAccessActive, pollOnce]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
    setIsScrolledToBottom(atBottom);
    if (atBottom) setNewMessageCount(0);
  };

  const scrollToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewMessageCount(0);
  };

  // ── Send / retry / delete ────────────────────────────────────────────────
  const handleSend = async (content: string) => {
    if (!classroom || !user) return;
    const clientId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: UiMessage = {
      id: clientId,
      clientId,
      classroomId: classroom.id,
      channel: activeChannel,
      messageType: MessageType.TEXT,
      metadata: null,
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      content,
      sender: { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl },
      clientStatus: 'sending',
    };
    setMessages((prev) => [...prev, optimistic]);
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

    try {
      const sent = await api.sendMessage(classroom.id, activeChannel, content);
      setMessages((prev) =>
        prev.map((m) => (m.clientId === clientId ? toUiMessage(sent, classroom.id, activeChannel) : m)),
      );
    } catch {
      setMessages((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, clientStatus: 'failed' } : m)));
    }
  };

  const handleRetry = (message: UiMessage) => {
    if (!message.content) return;
    setMessages((prev) => prev.filter((m) => m.clientId !== message.clientId));
    handleSend(message.content);
  };

  const handleDelete = async (messageId: string) => {
    if (!classroom) return;
    const previous = messagesRef.current;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, isDeleted: true, deletedAt: new Date().toISOString() } : m)),
    );
    try {
      await api.deleteMessage(classroom.id, messageId);
    } catch (err) {
      setMessages(previous);
      showToast(getErrorMessage(err), 'error');
    }
  };

  // ── RSVP ─────────────────────────────────────────────────────────────────
  const handleRsvp = async (eventId: string, status: RsvpStatus) => {
    setEvents((prev) => {
      const existing = prev[eventId];
      if (!existing) return prev;
      const counts = { going: 0, notGoing: 0, maybe: 0, ...existing.rsvpCounts };
      if (existing.userRsvp === 'going') counts.going--;
      if (existing.userRsvp === 'not_going') counts.notGoing--;
      if (existing.userRsvp === 'maybe') counts.maybe--;
      if (status === 'going') counts.going++;
      if (status === 'not_going') counts.notGoing++;
      if (status === 'maybe') counts.maybe++;
      return { ...prev, [eventId]: { ...existing, userRsvp: status, rsvpCounts: counts } };
    });
    if (!classroom) return;
    try {
      await api.rsvpEvent(classroom.id, eventId, status);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
      loadEvents();
    }
  };

  // ── Quick actions ────────────────────────────────────────────────────────
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/classroom/${globalId}`);
      showToast(t('infoSheet.linkCopied'), 'success');
    } catch {
      // Clipboard API can fail (permissions, insecure context) — same non-fatal case as MFA's copy-secret button.
      showToast(tCommon('error'), 'error');
    }
  };

  const handleLeave = async () => {
    if (!classroom) return;
    setLeaving(true);
    try {
      await api.leaveClassroom(classroom.id);
      router.push('/');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
      setLeaving(false);
    }
  };

  const upcomingEvents = useMemo(
    () =>
      Object.values(events)
        .filter((e) => new Date(e.eventDate).getTime() >= Date.now())
        .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()),
    [events],
  );

  if (!ready) return null;

  if (loading) {
    return (
      <AppShell showNav={false}>
        <div className={styles.centeredLoading}>
          <LoadingSpinner size="lg" />
        </div>
      </AppShell>
    );
  }

  if (loadError || !classroom) {
    return (
      <AppShell showNav={false}>
        <ErrorMessage message={loadError ?? tCommon('error')} fullPage onRetry={loadClassroomAndMembership} />
      </AppShell>
    );
  }

  if (!membership.isMember) {
    return (
      <AppShell showNav={false}>
        <div className={styles.nonMemberWrap}>
          <p className={styles.nonMemberName}>{classroom.name}</p>
          <p className={styles.nonMemberMeta}>
            {classroom.institution.name} · {t('card.memberCount', { count: classroom.memberCount })}
          </p>
          <Button variant="primary" size="lg" fullWidth loading={joining} onClick={handleJoin}>
            {t('nonMember.joinButton')}
          </Button>
        </div>
      </AppShell>
    );
  }

  // pending_auto counts as full access for messaging (see canAccessChannel()'s own comment) —
  // only a plain 'pending'/'rejected'/no membership sees the redacted, read-only view.
  const hasFullAccess =
    membership.verificationStatus === 'verified' || membership.verificationStatus === 'pending_auto';
  const showRedactedBanner = activeChannel === ChannelType.CLASSROOM && !hasFullAccess;

  return (
    <AppShell showNav={false}>
      <ClassroomHeader
        name={classroom.name}
        institutionName={classroom.institution.name}
        batchYear={classroom.batchYear}
        memberCount={classroom.memberCount}
        teacherCount={memberStats.teacherCount}
        verifiedCount={memberStats.verifiedCount}
        onStatsClick={() => setShowInfoSheet(true)}
      />
      <ChannelTabs active={activeChannel} onChange={setActiveChannel} />

      {!canAccessActive ? (
        <LockedChannel
          title={t(`locked.${activeChannel}.title`)}
          subtitle={t(`locked.${activeChannel}.subtitle`)}
          description={t(`locked.${activeChannel}.description`)}
        />
      ) : (
        <div className={styles.channelBody}>
          {membership.verificationStatus === 'pending_auto' && !earlyMemberBannerDismissed && (
            <div className={styles.earlyMemberBanner}>
              <span>{tMembership('earlyMemberBanner')}</span>
              <a href={`/verify?classroomId=${globalId}`}>{tMembership('verifyNow')}</a>
              <button type="button" className={styles.dismissButton} onClick={dismissEarlyMemberBanner} aria-label={tCommon('dismiss')}>
                ✕
              </button>
            </div>
          )}

          {showRedactedBanner && (
            <div className={styles.verifyBanner}>
              <span>{t('messages.redacted')}</span>
              <button type="button" onClick={() => router.push(`/verify?classroomId=${classroom.id}`)}>
                {t('nonMember.verifyNow')}
              </button>
            </div>
          )}

          <div className={styles.messageList} ref={listRef} onScroll={handleScroll}>
            {messagesLoading && messages.length === 0 && (
              <div className={styles.centeredLoading}>
                <LoadingSpinner size="md" />
              </div>
            )}
            {/* fullPage — ErrorMessage's non-fullPage variant renders bare
                red text with no retry button at all (BUG: "never show a
                blank page with just red error text" — this was exactly
                that bug). Only shown for a genuine fetch failure; an empty
                array from a successful call goes to the empty state below instead. */}
            {messagesError && (
              <ErrorMessage message={messagesError} onRetry={loadMessages} fullPage />
            )}
            {!messagesLoading && !messagesError && messages.length === 0 && (
              <div className={styles.emptyMessages}>
                <span className={styles.emptyMessagesIcon} aria-hidden="true">
                  👋
                </span>
                <p>{t('messages.empty')}</p>
              </div>
            )}
            {messages.map((message) =>
              message.messageType === MessageType.EVENT_CARD ? (
                <EventMessageCard
                  key={message.id}
                  event={message.metadata?.event_id ? events[message.metadata.event_id as string] ?? null : null}
                  fallbackTitle={message.content ?? ''}
                  onRsvp={handleRsvp}
                />
              ) : (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isOwn={message.sender?.id === user?.id}
                  onDelete={handleDelete}
                  onRetry={handleRetry}
                />
              ),
            )}
          </div>

          {newMessageCount > 0 && (
            <button type="button" className={styles.newMessagesBanner} onClick={scrollToBottom}>
              ↓ {t('messages.newMessages', { count: newMessageCount })}
            </button>
          )}

          {hasFullAccess && <MessageInput onSend={handleSend} />}
        </div>
      )}

      {showInfoSheet && (
        <BottomSheet onClose={() => setShowInfoSheet(false)}>
          <ClassInfoSheet
            classroomName={classroom.name}
            institutionName={classroom.institution.name}
            memberCount={classroom.memberCount}
            memberPreview={members.map((m) => ({ userId: m.userId, fullName: m.fullName ?? '', avatarUrl: m.avatarUrl }))}
            upcomingEvents={upcomingEvents}
            onViewAllMembers={() => {
              setShowInfoSheet(false);
              setShowMemberModal(true);
            }}
            onCreateEvent={() => {
              setShowInfoSheet(false);
              setShowEventModal(true);
            }}
            onShare={handleShare}
            onLeave={() => {
              setShowInfoSheet(false);
              setShowLeaveConfirm(true);
            }}
          />
        </BottomSheet>
      )}

      {showMemberModal && user && (
        <MemberListModal
          classroomId={classroom.id}
          members={members}
          currentUserId={user.id}
          viewerIsVerified={membership.isVerified}
          onClose={() => setShowMemberModal(false)}
        />
      )}

      {showEventModal && (
        <EventCreateModal
          classroomId={classroom.id}
          onClose={() => setShowEventModal(false)}
          onCreated={() => {
            setShowEventModal(false);
            showToast(t('eventCreate.successToast'), 'success');
            loadEvents();
          }}
        />
      )}

      {showLeaveConfirm && (
        <Modal title={t('infoSheet.leaveConfirmTitle', { name: classroom.name })} onClose={() => setShowLeaveConfirm(false)}>
          <p className={styles.leaveMessage}>{t('infoSheet.leaveConfirmMessage')}</p>
          <div className={styles.leaveActions}>
            <Button variant="ghost" size="md" onClick={() => setShowLeaveConfirm(false)} disabled={leaving}>
              {tCommon('cancel')}
            </Button>
            <Button variant="danger" size="md" loading={leaving} onClick={handleLeave}>
              {t('infoSheet.leaveButton')}
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
