'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChannelType, MessageType } from '@alumini/types';
import type { Classroom, Event as ClassroomEvent, Institution, Message, RedactedMessage } from '@alumini/types';
import * as api from '@/lib/api';
import type { ClassroomMember } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate } from '@/lib/format';
import { useAuth } from '@/components/providers/AuthProvider';
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
import { EventDetailSheet } from './EventDetailSheet';
import { MessageInput, type VisitingCityInput } from './MessageInput';
import { ClassInfoSheet } from './ClassInfoSheet';
import { ClassroomPreview } from './ClassroomPreview';
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

// TASKS_09 TASK 07 — BUG FIX: pending_auto used to count as "full access"
// for posting in classroom/student_alley, matching the backend bug this
// fix pairs with (MembershipService.canAccessChannel()) — only 'verified'
// may post, in any channel; pending_auto is read-only until they actually
// verify (SPEC.md §7.4's "Joined, unverified: Chat (redacted), No post").
function canPostChannel(role: string | null, verificationStatus: string | null, channel: ChannelType): boolean {
  const isVerified = verificationStatus === 'verified';
  if (channel === ChannelType.CLASSROOM) return isVerified;
  if (channel === ChannelType.STAFF_ROOM) return isVerified && (role === 'teacher' || role === 'admin');
  if (channel === ChannelType.STUDENT_ALLEY) return isVerified && role === 'student';
  return false;
}

export default function ClassroomPage() {
  const params = useParams<{ globalId: string }>();
  const globalId = params.globalId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkedEventId = searchParams.get('eventId');
  // TASKS_09 TASK 18 — this page is now public for non-members (share-link
  // landing), so it no longer force-redirects to /auth/login the way
  // useRequireAuth() does. AuthProvider already withholds rendering until
  // it's finished reading localStorage (see its own comment), so
  // isLoggedIn is accurate from this component's very first render — no
  // separate "ready" wait is needed here either.
  const { user, isLoggedIn } = useAuth();
  const { showToast } = useToast();
  const t = useTranslations('classroom');
  const tCommon = useTranslations('common');
  const tMembership = useTranslations('membership');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [preview, setPreview] = useState<api.ClassroomPreview | null>(null);
  const [membership, setMembership] = useState<MembershipInfo>({
    isMember: false,
    isVerified: false,
    verificationStatus: null,
    userRole: null,
    joinedAt: null,
  });

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
  const [memberStats, setMemberStats] = useState({ verifiedCount: 0, pendingCount: 0 });

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
  // TASKS_09 TASK 16 — the event whose detail sheet is open, if any.
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  // ── Load classroom + membership ─────────────────────────────────────────
  //
  // No GET /membership/:classroomId endpoint exists on the backend — the
  // task's own spec assumed one, but MembershipService has no public
  // controller. getMyClassrooms() already carries per-classroom
  // verificationStatus/userRole for every classroom the caller belongs to,
  // so membership is derived by matching this classroom's globalId there
  // instead: present in that list = member, absent = not a member.
  //
  // TASKS_09 TASK 18 — a logged-out visitor (or a logged-in non-member)
  // now gets the public preview instead of a 401/redirect: getClassroom()
  // was already an unauthenticated endpoint (@Get(':idOrGlobalId') has no
  // guard), but getMyClassrooms() requires a session, so that call is only
  // made when isLoggedIn. Membership only ever ends up true when logged
  // in AND a match is found; every other combination (logged out, or
  // logged in but not a member) falls through to fetching the dedicated
  // public preview payload (verifiedCount/upcomingEvents aren't on the
  // plain classroom response) and rendering ClassroomPreview instead.
  const loadClassroomAndMembership = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (isLoggedIn) {
        const [classroomData, myClassrooms] = await Promise.all([
          api.getClassroom(globalId),
          api.getMyClassrooms(),
        ]);
        const match = myClassrooms.flatMap((g) => g.classes).find((c) => c.globalId === globalId);
        if (match) {
          setClassroom(classroomData);
          setPreview(null);
          setMembership({
            isMember: true,
            isVerified: match.verificationStatus === 'verified',
            verificationStatus: match.verificationStatus,
            userRole: (match.userRole as string | undefined) ?? null,
            joinedAt: match.joinedAt ?? null,
          });
          return;
        }
      }

      const previewData = await api.getClassroomPreview(globalId);
      setClassroom(null);
      setPreview(previewData);
      setMembership({ isMember: false, isVerified: false, verificationStatus: null, userRole: null, joinedAt: null });
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [globalId, isLoggedIn]);

  useEffect(() => {
    loadClassroomAndMembership();
  }, [loadClassroomAndMembership]);

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
      pendingCount: all.filter((m) => m.verificationStatus === 'pending' || m.verificationStatus === 'pending_auto').length,
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
  // TASKS_09 TASK 24/25 — isAnnouncement/visitingCity thread through to
  // both the optimistic bubble's own messageType/metadata (so it renders
  // with the right styling immediately) and the actual API call.
  const handleSend = async (content: string, isAnnouncement = false, visitingCity?: VisitingCityInput) => {
    if (!classroom || !user) return;
    const clientId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: UiMessage = {
      id: clientId,
      clientId,
      classroomId: classroom.id,
      channel: activeChannel,
      messageType: visitingCity ? MessageType.VISITING_CITY : isAnnouncement ? MessageType.ANNOUNCEMENT : MessageType.TEXT,
      metadata: visitingCity ? { city: visitingCity.city, from_date: visitingCity.fromDate, to_date: visitingCity.toDate, responders: [] } : null,
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
      const messageType = visitingCity ? 'visiting_city' : isAnnouncement ? 'announcement' : 'text';
      const sent = await api.sendMessage(classroom.id, activeChannel, content, messageType, visitingCity);
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
    const meta = message.metadata as { city?: string; from_date?: string; to_date?: string } | null;
    const visitingCity =
      message.messageType === MessageType.VISITING_CITY && meta?.city && meta.from_date && meta.to_date
        ? { city: meta.city, fromDate: meta.from_date, toDate: meta.to_date }
        : undefined;
    handleSend(message.content, message.messageType === MessageType.ANNOUNCEMENT, visitingCity);
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

  // TASKS_09 TASK 25 — "I'm there too", optimistic (button disables
  // immediately) with rollback on failure. Idempotent server-side too, so
  // a double-click racing this optimistic update is harmless either way.
  const handleImThere = async (messageId: string) => {
    if (!user) return;
    const previous = messagesRef.current;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const meta = (m.metadata as { responders?: string[] } | null) ?? {};
        const responders = meta.responders ?? [];
        if (responders.includes(user.id)) return m;
        return { ...m, metadata: { ...meta, responders: [...responders, user.id] } };
      }),
    );
    try {
      await api.imThere(messageId);
    } catch (err) {
      setMessages(previous);
      showToast(getErrorMessage(err), 'error');
    }
  };

  // ── RSVP ─────────────────────────────────────────────────────────────────
  // TASKS_09 TASK 16 — EventDetailSheet owns the detail sheet's own RSVP
  // call (optimistic update + POST /rsvp). This just folds its result back
  // into the classroom-wide `events` map so every surface (chat card,
  // ClassInfoSheet's list) reflects the new status without a full reload.
  const handleRsvpChanged = (eventId: string, rsvps: api.RsvpSummary) => {
    setEvents((prev) => {
      const existing = prev[eventId];
      if (!existing) return prev;
      return {
        ...prev,
        [eventId]: {
          ...existing,
          userRsvp: rsvps.myRsvp ?? undefined,
          rsvpCounts: { going: rsvps.going, notGoing: rsvps.notGoing, maybe: rsvps.maybe },
        },
      };
    });
  };

  // TASKS_09 TASK 21 FIX D — the chat event card's own quick RSVP pills
  // (Going/Pass/Maybe), separate from the detail sheet's: optimistic
  // update here too, same rollback-on-error shape as EventDetailSheet's
  // handleRsvp(), but without a loading/disabled state — a chat pill is a
  // much lighter-weight action than the sheet's full RSVP flow.
  const handleQuickRsvp = async (eventId: string, status: api.RsvpSummary['myRsvp']) => {
    if (!classroom || !status) return;
    const previous = events[eventId];
    if (!previous) return;
    const previousCounts = previous.rsvpCounts ?? { going: 0, notGoing: 0, maybe: 0 };
    const optimisticCounts = { ...previousCounts };
    if (previous.userRsvp === 'going') optimisticCounts.going--;
    if (previous.userRsvp === 'not_going') optimisticCounts.notGoing--;
    if (previous.userRsvp === 'maybe') optimisticCounts.maybe--;
    if (status === 'going') optimisticCounts.going++;
    if (status === 'not_going') optimisticCounts.notGoing++;
    if (status === 'maybe') optimisticCounts.maybe++;

    setEvents((prev) => ({ ...prev, [eventId]: { ...previous, userRsvp: status, rsvpCounts: optimisticCounts } }));

    try {
      const rsvps = await api.rsvpEvent(classroom.id, eventId, status);
      handleRsvpChanged(eventId, rsvps);
    } catch (err) {
      setEvents((prev) => ({ ...prev, [eventId]: previous }));
      showToast(getErrorMessage(err), 'error');
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

  // TASKS_09 TASK 21 FIX C — role lookup for message senders, from the
  // already-loaded member roster (loadMemberStats() above) rather than a
  // separate fetch.
  const roleById = useMemo(() => new Map(members.map((m) => [m.userId, m.role])), [members]);

  if (loading) {
    return (
      <AppShell showNav={false}>
        <div className={styles.centeredLoading}>
          <LoadingSpinner size="lg" />
        </div>
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell showNav={false}>
        <ErrorMessage message={loadError} fullPage onRetry={loadClassroomAndMembership} />
      </AppShell>
    );
  }

  // TASKS_09 TASK 18 — public preview for a non-member (logged out, or
  // logged in but hasn't joined). onJoined just reloads this same
  // load — a successful join flips membership.isMember true on the next
  // fetch, so this component falls through to the full view below.
  if (!membership.isMember) {
    if (!preview) return null;
    return (
      <AppShell showNav={false}>
        <ClassroomPreview globalId={globalId} preview={preview} isLoggedIn={isLoggedIn} onJoined={loadClassroomAndMembership} />
      </AppShell>
    );
  }

  if (!classroom) return null;

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
    <AppShell showNav={false} fixedHeight>
      <ClassroomHeader
        classroomId={classroom.id}
        name={classroom.name}
        grade={classroom.grade}
        section={classroom.section}
        program={classroom.program}
        institutionName={classroom.institution.name}
        institutionType={classroom.institution.type}
        batchYear={classroom.batchYear}
        memberCount={classroom.memberCount}
        verifiedCount={memberStats.verifiedCount}
        pendingCount={memberStats.pendingCount}
        userRole={membership.userRole}
        coverUrl={classroom.coverUrl}
        canUploadCover={
          membership.userRole === 'admin' || user?.id === classroom.createdBy || membership.verificationStatus === 'verified'
        }
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
          {/* Status-specific banners — pending_auto/pending/rejected each get
              their own copy rather than one generic "not verified yet"
              message; verified members see no banner at all. */}
          {membership.verificationStatus === 'pending_auto' && !verifyBannerDismissed && (
            <div className={styles.verifyNudgeBanner}>
              <span>
                {tMembership('pendingAutoBanner')}{' '}
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

          {membership.verificationStatus === 'pending' && !verifyBannerDismissed && (
            <div className={styles.verifyNudgeBanner}>
              <span>{tMembership('pendingBanner')}</span>
              <button type="button" className={styles.dismissButton} onClick={dismissVerifyBanner} aria-label={tCommon('dismiss')}>
                ✕
              </button>
            </div>
          )}

          {membership.verificationStatus === 'rejected' && (
            <div className={styles.rejectedBanner}>
              <span>{tMembership('rejectedBanner')}</span>
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
                  onOpen={setOpenEventId}
                  onQuickRsvp={handleQuickRsvp}
                />
              ) : (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isOwn={message.sender?.id === user?.id}
                  senderRole={message.sender ? roleById.get(message.sender.id) : undefined}
                  currentUserId={user?.id}
                  onDelete={handleDelete}
                  onRetry={handleRetry}
                  onImThere={handleImThere}
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
            city={classroom.city ?? classroom.institution.cityCode ?? null}
            createdAt={classroom.createdAt}
            memberCount={classroom.memberCount}
            memberPreview={members.map((m) => ({ userId: m.userId, fullName: m.fullName ?? '', avatarUrl: m.avatarUrl }))}
            upcomingEvents={upcomingEvents}
            highlightEventId={deepLinkedEventId}
            onOpenEvent={(eventId) => {
              setShowInfoSheet(false);
              setOpenEventId(eventId);
            }}
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

      {openEventId && (
        <BottomSheet onClose={() => setOpenEventId(null)}>
          <EventDetailSheet
            classroomId={classroom.id}
            eventId={openEventId}
            onRsvpChanged={handleRsvpChanged}
            onClose={() => setOpenEventId(null)}
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
