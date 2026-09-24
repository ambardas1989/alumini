'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChannelType, MessageType } from '@alumini/types';
import type { Classroom, Event as ClassroomEvent, Institution, Message, RedactedMessage, RsvpStatus } from '@alumini/types';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { ClassroomMember } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate } from '@/lib/format';
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
import messageBubbleStyles from './MessageBubble.module.css';
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
// FRONTEND FIX 2 / TASKS_03 TASK 03 step 3: pollOnce() used to retry every
// POLL_INTERVAL_MS forever on failure — a channel that consistently
// 403'd/500'd (e.g. the PGRST201 bug, or a role mismatch) meant an open tab
// made one request every 5s indefinitely (200+ requests inside 20 minutes).
// Now backs off exponentially (1s, 2s, 4s) across up to MAX_POLL_FAILURES
// consecutive misses, then stops scheduling entirely and requires an
// explicit manual retry — never auto-retries indefinitely.
const MAX_POLL_FAILURES = 3;
const POLL_BACKOFF_MS = [1000, 2000, 4000];

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

// FIX 1 — staff_room and student_alley are now SYMMETRIC hard locks:
// staff_room is teacher/admin-only (students get 403, not a degraded
// view), student_alley is student-only (teachers/admins get 403).
// Reversed from an earlier design that let students read staff_room.
// Mirrors corridor.service.ts's getMessages()/canAccessChannel() split
// exactly — see their own comments.
function canReadChannel(role: string | null, verificationStatus: string | null, channel: ChannelType): boolean {
  const hasFullAccess = verificationStatus === 'verified' || verificationStatus === 'pending_auto';
  if (channel === ChannelType.CLASSROOM) return true; // unverified gets the degraded/redacted view, not a lock
  if (channel === ChannelType.STAFF_ROOM) return hasFullAccess && (role === 'teacher' || role === 'admin');
  if (channel === ChannelType.STUDENT_ALLEY) return hasFullAccess && role === 'student';
  return false;
}

function canPostChannel(role: string | null, verificationStatus: string | null, channel: ChannelType): boolean {
  const hasFullAccess = verificationStatus === 'verified' || verificationStatus === 'pending_auto';
  if (channel === ChannelType.CLASSROOM) return hasFullAccess;
  if (channel === ChannelType.STAFF_ROOM) return verificationStatus === 'verified' && (role === 'teacher' || role === 'admin');
  if (channel === ChannelType.STUDENT_ALLEY) return hasFullAccess && role === 'student';
  return false;
}

export default function ClassroomPage() {
  const params = useParams<{ globalId: string }>();
  const globalId = params.globalId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkedEventId = searchParams.get('eventId');
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
    joinedAt: null,
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

  // FRONTEND FIX 2 — see MAX_POLL_FAILURES above.
  const pollFailureCountRef = useRef(0);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);

  const [members, setMembers] = useState<ClassroomMember[]>([]);
  const [memberStats, setMemberStats] = useState({ verifiedCount: 0 });

  const [showInfoSheet, setShowInfoSheet] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  // TASKS_08 TASK 07 FIX B — set when the "+" button opens MemberListModal
  // directly from the Staff Room/Student Alley tab; undefined (Classroom
  // tab) opens ClassInfoSheet instead, or the full unfiltered roster.
  const [memberModalRoleFilter, setMemberModalRoleFilter] = useState<'teacher' | 'student' | undefined>(undefined);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);

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
        joinedAt: match?.joinedAt ?? null,
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

  // TASKS_03.md TASK 09 — exact key format the spec requires.
  const verifyBannerKey = `dismissed_verify_banner_${globalId}`;

  useEffect(() => {
    try {
      setVerifyBannerDismissed(window.localStorage.getItem(verifyBannerKey) === '1');
    } catch {
      // localStorage unavailable (private mode, etc.) — banner just stays visible.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalId]);

  const dismissVerifyBanner = () => {
    setVerifyBannerDismissed(true);
    try {
      window.localStorage.setItem(verifyBannerKey, '1');
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
      // TASKS_09 TASK 03 (confirmed as part of TASK 11's own prerequisite
      // check) — a 409 here means the caller is ALREADY a member (see
      // ClassroomService.joinClassroom()'s ConflictException). That's not
      // a failure from the user's perspective — showing an error and
      // leaving them stuck on the join prompt was the actual bug. Treat it
      // as success: reload membership so the classroom renders normally.
      if (err instanceof ApiError && err.statusCode === 409) {
        // eslint-disable-next-line no-console
        console.warn('[MEMBERSHIP:join] already member — treating as success', { classroomId: classroom.id });
        await loadClassroomAndMembership();
      } else {
        showToast(getErrorMessage(err), 'error');
      }
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

  // TASKS_09 TASK 11 FIX 2/3 — an event deep link (from a notification or
  // /classroom/[globalId]/events/[eventId], which redirects here with the
  // same query param) opens the info sheet once membership is confirmed,
  // so the user lands on the classroom's events list instead of nowhere in
  // particular. Membership is checked first (via the loading/join-prompt
  // gate above this effect never runs until membership.isMember is true),
  // so a non-member still sees the join prompt, never the sheet.
  useEffect(() => {
    if (!deepLinkedEventId || !classroom || !membership.isMember) return;
    setShowInfoSheet(true);
  }, [deepLinkedEventId, classroom, membership.isMember]);

  // ── Messages: load on channel switch, poll while active + verified ─────
  const canReadActive = canReadChannel(membership.userRole, membership.verificationStatus, activeChannel);
  const canPostActive = canPostChannel(membership.userRole, membership.verificationStatus, activeChannel);

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
    if (!classroom || !membership.isMember || !canReadActive) return;
    setMessages([]);
    // Switching channels (or reloading the classroom) is a fresh start —
    // don't carry a stale "polling stopped" state from a different tab.
    pollFailureCountRef.current = 0;
    setPollingStopped(false);
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom, membership.isMember, activeChannel, canReadActive]);

  // Returns the delay (ms) before the NEXT poll should run: the steady
  // 5s cadence after a clean poll, or the next exponential-backoff step
  // (1s/2s/4s) after a failure — null once MAX_POLL_FAILURES is reached,
  // meaning "stop, don't schedule anything else."
  const pollOnce = useCallback(async (): Promise<number | null> => {
    if (!classroom) return null;
    try {
      const data = await api.getMessages(classroom.id, activeChannel, 0);
      pollFailureCountRef.current = 0;
      const fresh = toAscending(data, classroom.id, activeChannel);
      const knownIds = new Set(messagesRef.current.filter((m) => !m.clientId).map((m) => m.id));
      const newOnes = fresh.filter((m) => !knownIds.has(m.id));
      if (newOnes.length > 0) {
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
      }
      return POLL_INTERVAL_MS;
    } catch (err) {
      // Silent to the UI per-attempt — a single blip shouldn't interrupt
      // the reading experience with an error banner — but still logged for
      // debugging, and counted: after MAX_POLL_FAILURES consecutive misses
      // (each retried sooner than the last via POLL_BACKOFF_MS) this stops
      // polling entirely rather than retrying forever (FIX 2).
      // eslint-disable-next-line no-console
      console.error('[CLASSROOM-ERROR] Poll failed', { classroomId: classroom.id, channel: activeChannel, err });
      const attempt = pollFailureCountRef.current;
      pollFailureCountRef.current += 1;
      if (pollFailureCountRef.current >= MAX_POLL_FAILURES) {
        setPollingStopped(true);
        return null;
      }
      return POLL_BACKOFF_MS[attempt] ?? POLL_BACKOFF_MS[POLL_BACKOFF_MS.length - 1]!;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom, activeChannel]);

  useEffect(() => {
    if (!classroom || !membership.isMember || !canReadActive || pollingStopped) return;

    let cancelled = false;

    const scheduleNext = (delayMs: number) => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = setTimeout(async () => {
        if (cancelled || document.visibilityState !== 'visible') {
          // Tab is hidden — don't burn a request, just check again shortly
          // once it might be visible instead of firing blind.
          if (!cancelled) scheduleNext(POLL_INTERVAL_MS);
          return;
        }
        const nextDelay = await pollOnce();
        if (!cancelled && nextDelay !== null) scheduleNext(nextDelay);
      }, delayMs);
    };

    scheduleNext(POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    };
  }, [classroom, membership.isMember, activeChannel, canReadActive, pollingStopped, pollOnce]);

  const resumePolling = () => {
    pollFailureCountRef.current = 0;
    setPollingStopped(false);
    loadMessages();
  };

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

  // FIX 1 — a verified/pending_auto student hitting staff_room's lock gets
  // a small role-specific note, not the full LockedChannel treatment
  // (which stays for "you need to verify first" and for student_alley's
  // teacher/admin lock — that copy is still accurate for those cases).
  const staffRoomRoleLocked =
    activeChannel === ChannelType.STAFF_ROOM && hasFullAccess && membership.userRole === 'student';

  // TASKS_08 TASK 07 FIX B — the "+" button's target depends on which tab
  // is active: Classroom → the class info panel, Staff Room/Student Alley
  // → that channel's member roster, filtered to the matching role.
  const handleInfoButtonClick = () => {
    if (activeChannel === ChannelType.STAFF_ROOM) {
      setMemberModalRoleFilter('teacher');
      setShowMemberModal(true);
    } else if (activeChannel === ChannelType.STUDENT_ALLEY) {
      setMemberModalRoleFilter('student');
      setShowMemberModal(true);
    } else {
      setShowInfoSheet(true);
    }
  };

  return (
    <AppShell showNav={false}>
      <ClassroomHeader
        classroomId={classroom.id}
        name={classroom.name}
        grade={classroom.grade}
        section={classroom.section}
        program={classroom.program}
        institutionName={classroom.institution.name}
        batchYear={classroom.batchYear}
        memberCount={classroom.memberCount}
        verifiedCount={memberStats.verifiedCount}
        userRole={membership.userRole}
        coverUrl={classroom.coverUrl}
        onCoverUpdated={(coverUrl) => setClassroom((prev) => (prev ? { ...prev, coverUrl } : prev))}
        onStatsClick={() => setShowInfoSheet(true)}
      />
      <ChannelTabs active={activeChannel} onChange={setActiveChannel} onInfoClick={handleInfoButtonClick} />

      {!canReadActive ? (
        staffRoomRoleLocked ? (
          <div className={styles.staffRoomRestricted}>
            <p>{t('locked.staff_room.studentMessage')}</p>
          </div>
        ) : (
          <LockedChannel
            title={t(`locked.${activeChannel}.title`)}
            subtitle={t(`locked.${activeChannel}.subtitle`)}
            description={t(`locked.${activeChannel}.description`)}
          />
        )
      ) : (
        <div className={styles.channelBody}>
          {(membership.verificationStatus === 'pending' || membership.verificationStatus === 'pending_auto') &&
            !verifyBannerDismissed && (
              <div className={styles.verifyNudgeBanner}>
                <span>
                  {tMembership('verifyNudge')}{' '}
                  {/* BUG FIX — was the route's globalId param (e.g.
                      "IN-KOL-KVFORTW-10C-2006"), not the classroom's
                      internal UUID. api.getMembership()/getVerificationStatus()
                      forward this straight into a `.eq('classroom_id', ...)`
                      query on a UUID column, so a globalId string here
                      raised "invalid input syntax for type uuid" — see
                      classroom.id below, which is already correct. */}
                  <a href={`/verify?classroomId=${classroom.id}`}>{tMembership('completeVerification')}</a>
                </span>
                <button type="button" className={styles.dismissButton} onClick={dismissVerifyBanner} aria-label={tCommon('dismiss')}>
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
            {/* TASKS_08 TASK 06 — messages before the caller's own join date
                are filtered out server-side (CorridorService.getMessages());
                this pill explains why the history looks like it starts here. */}
            {membership.joinedAt && (
              <div className={messageBubbleStyles.systemRow}>
                <span className={messageBubbleStyles.systemText}>
                  {t('messages.joinedOn', { date: safeFormatDate(membership.joinedAt) })}
                </span>
              </div>
            )}
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

          {pollingStopped && (
            <div className={styles.pollStoppedBanner}>
              <span>{t('messages.liveUpdatesPaused')}</span>
              <button type="button" onClick={resumePolling}>
                {tCommon('retry')}
              </button>
            </div>
          )}

          {canPostActive ? (
            <MessageInput onSend={handleSend} />
          ) : (
            hasFullAccess && (
              // FIX 1: staff_room now requires teacher/admin to even READ,
              // so this is reachable only for a pending_auto (early-member)
              // teacher/admin — canReadChannel() accepts pending_auto,
              // canPostChannel() requires strictly 'verified' for staff_room.
              // classroom's own "can't post yet" case is the verifyBanner
              // nudge above, not this; student_alley's read/post rules are
              // identical so it never reaches here either.
              <p className={styles.postRestrictedNote}>
                {t(`postRestricted.${activeChannel}`)}
              </p>
            )
          )}
        </div>
      )}

      {showInfoSheet && (
        <BottomSheet onClose={() => setShowInfoSheet(false)}>
          <ClassInfoSheet
            classroomName={classroom.name}
            institutionName={classroom.institution.name}
            globalId={classroom.globalId}
            createdAt={classroom.createdAt}
            memberCount={classroom.memberCount}
            memberPreview={members.map((m) => ({ userId: m.userId, fullName: m.fullName ?? '', avatarUrl: m.avatarUrl }))}
            upcomingEvents={upcomingEvents}
            highlightEventId={deepLinkedEventId}
            onViewAllMembers={() => {
              setShowInfoSheet(false);
              setMemberModalRoleFilter(undefined);
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
          creatorId={classroom.createdBy}
          viewerIsAdminOrCreator={membership.userRole === 'admin' || user.id === classroom.createdBy}
          onMemberVerified={(userId) =>
            setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, verificationStatus: 'verified' } : m)))
          }
          roleFilter={memberModalRoleFilter}
          onClose={() => setShowMemberModal(false)}
        />
      )}

      {showEventModal && (
        <EventCreateModal
          classroomId={classroom.id}
          channel={activeChannel}
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
