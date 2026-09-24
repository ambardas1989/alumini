'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import type { NotificationRow } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { safeRelativeTime } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import styles from './NotificationBell.module.css';

const UNREAD_POLL_INTERVAL_MS = 60_000;
// "Cache for 30 seconds (don't refetch if reopened quickly)" per the task spec.
const LIST_CACHE_MS = 30_000;

/**
 * TASK 09. Real-time updates would normally come from a Supabase Realtime
 * subscription on `notifications`, but this app's client-side Supabase
 * instance (lib/supabase.ts) is only ever used anonymously for document
 * uploads — it's never authenticated as the signed-in user (this app uses
 * its own custom JWT, not Supabase Auth sessions), so a Realtime
 * subscription gated by the notifications_own RLS policy (auth.uid()-based)
 * would never actually match any rows. This is exactly the "JWT mismatch
 * known issue" the task's own fallback anticipates — going straight to the
 * documented fallback: polling GET /notifications/unread-count only, for
 * the badge count, every 60s.
 */
export function NotificationBell() {
  const router = useRouter();
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastFetchedAt = useRef(0);

  const refreshUnreadCount = () => {
    // TASKS_07 TASK 10 — stops this interval's own tick from firing a
    // request once the token's gone, rather than relying solely on
    // lib/api.ts's isLoggingOut() guard (which only covers the brief
    // window right around sign-out, not e.g. a token that expired while
    // this tab sat idle in the background).
    if (!getToken()) return;
    api
      .getUnreadNotificationCount()
      .then((r) => setUnreadCount(r.count))
      .catch(() => undefined);
  };

  useEffect(() => {
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, UNREAD_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && Date.now() - lastFetchedAt.current > LIST_CACHE_MS) {
      setLoading(true);
      api
        .getNotifications(20)
        .then((rows) => {
          setItems(rows);
          lastFetchedAt.current = Date.now();
        })
        .finally(() => setLoading(false));
    }
  };

  const handleMarkAllRead = async () => {
    await api.markNotificationsRead({ all: true });
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
    setUnreadCount(0);
  };

  const handleItemClick = async (item: NotificationRow) => {
    if (!item.is_read) {
      await api.markNotificationsRead({ notificationIds: [item.id] });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_read: true } : i)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    const classroomId = (item.data?.classroom_id as string | undefined) ?? null;
    if (!classroomId) return;
    // TASKS_09 TASK 11 FIX 3 — an event notification's own eventId, when
    // present, is forwarded so the classroom page can surface that
    // specific event once membership is confirmed (see its own
    // eventId-handling effect) instead of just dropping the user on the
    // classroom's default view.
    const eventId = (item.data?.event_id as string | undefined) ?? null;
    router.push(eventId ? `/classroom/${classroomId}?eventId=${eventId}` : `/classroom/${classroomId}`);
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={handleToggle}
        aria-label={t('bellLabel')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <BellIcon />
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label={t('title')}>
          <div className={styles.header}>
            <span className={styles.headerTitle}>{t('title')}</span>
            {items.some((i) => !i.is_read) && (
              <button type="button" className={styles.markAllRead} onClick={handleMarkAllRead}>
                {t('markAllRead')}
              </button>
            )}
          </div>

          <div className={styles.list}>
            {loading && (
              <>
                <div className={styles.skeletonRow} />
                <div className={styles.skeletonRow} />
                <div className={styles.skeletonRow} />
              </>
            )}

            {!loading && items.length === 0 && (
              <div className={styles.empty}>
                <span className={styles.emptyIcon} aria-hidden="true">
                  🔔
                </span>
                <p>{t('empty')}</p>
              </div>
            )}

            {!loading &&
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.item}
                  onClick={() => handleItemClick(item)}
                >
                  <span className={`${styles.dot} ${!item.is_read ? styles.dotUnread : ''}`} aria-hidden="true" />
                  <span className={styles.itemText}>
                    <span className={`${styles.itemTitle} ${!item.is_read ? styles.itemTitleUnread : ''}`}>
                      {item.title}
                    </span>
                    {item.body && <span className={styles.itemBody}>{item.body}</span>}
                  </span>
                  <span className={styles.itemTime}>{safeRelativeTime(item.created_at)}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
