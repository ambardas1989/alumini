'use client';

import { useState } from 'react';
import type { Event as ClassroomEvent } from '@alumini/types';
import { safeFormatDate } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EventTile } from './EventTile';
import styles from './ClassInfoSheet.module.css';

const COLLAPSED_EVENT_LIMIT = 2;

interface MemberAvatar {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
}

interface ClassInfoSheetProps {
  classroomName: string;
  institutionName: string;
  /** TASKS_09 TASK 17 FIX B — classroom's own city, falling back to its institution's cityCode; omitted entirely when neither is available. */
  city?: string | null;
  createdAt: string;
  memberCount: number;
  memberPreview: MemberAvatar[];
  upcomingEvents: ClassroomEvent[];
  /** TASKS_09 TASK 11 FIX 2/3 — the event an incoming deep link pointed at, highlighted so it doesn't just blend into the list. */
  highlightEventId?: string | null;
  onOpenEvent: (eventId: string) => void;
  onViewAllMembers: () => void;
  onCreateEvent: () => void;
  onShare: () => void;
  onLeave: () => void;
}

const PREVIEW_LIMIT = 8;

export function ClassInfoSheet({
  classroomName,
  institutionName,
  city,
  createdAt,
  memberCount,
  memberPreview,
  upcomingEvents,
  highlightEventId,
  onOpenEvent,
  onViewAllMembers,
  onCreateEvent,
  onShare,
  onLeave,
}: ClassInfoSheetProps) {
  const t = useTranslations('classroom.infoSheet');
  const tEvents = useTranslations('classroom.events.collapse');
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const visible = memberPreview.slice(0, PREVIEW_LIMIT);
  const overflow = memberCount - visible.length;
  const visibleEvents = eventsExpanded ? upcomingEvents : upcomingEvents.slice(0, COLLAPSED_EVENT_LIMIT);
  const hiddenEventCount = upcomingEvents.length - COLLAPSED_EVENT_LIMIT;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <p className={styles.name}>{classroomName}</p>
        {/* TASKS_09 TASK 17 FIX B — city appended to the institution line when known, e.g. "KV Fort William · Kolkata". */}
        <p className={styles.institution}>
          {institutionName}
          {city ? ` · ${city}` : ''}
        </p>
      </div>

      {/* TASKS_09 TASK 17 FIX A — the raw global ID row is gone; "Share
          classroom link" below already carries the same ID in its copied
          URL, so showing it twice was redundant. */}
      <section className={styles.section}>
        <p className={styles.createdAt}>{t('createdOn', { date: safeFormatDate(createdAt) })}</p>
      </section>

      <section className={styles.section}>
        <p className={styles.sectionLabel}>{t('membersCount', { count: memberCount })}</p>
        <div className={styles.avatarRow}>
          {visible.map((m, i) => (
            <span key={m.userId} className={styles.avatarOverlap} style={{ zIndex: visible.length - i }}>
              <Avatar avatarUrl={m.avatarUrl} fullName={m.fullName} size="md" />
            </span>
          ))}
          {overflow > 0 && <span className={styles.overflowBadge}>+{overflow}</span>}
        </div>
        <button type="button" className={styles.link} onClick={onViewAllMembers}>
          {t('viewAllMembers')}
        </button>
      </section>

      <section className={styles.section}>
        <p className={styles.sectionLabel}>{t('upcomingEvents')}</p>
        {upcomingEvents.length === 0 ? (
          <p className={styles.emptyText}>{t('noUpcomingEvents')}</p>
        ) : (
          <>
            <div className={styles.eventList}>
              {visibleEvents.map((event) => (
                <div key={event.id} className={event.id === highlightEventId ? styles.eventRowHighlighted : undefined}>
                  <EventTile event={event} onOpen={onOpenEvent} />
                </div>
              ))}
            </div>
            {/* TASKS_09 TASK 16 — collapse past the first 2 upcoming events. */}
            {!eventsExpanded && hiddenEventCount > 0 && (
              <button type="button" className={styles.eventsToggle} onClick={() => setEventsExpanded(true)}>
                {tEvents('showMore', { count: hiddenEventCount })}
              </button>
            )}
            {eventsExpanded && upcomingEvents.length > COLLAPSED_EVENT_LIMIT && (
              <button type="button" className={styles.eventsToggle} onClick={() => setEventsExpanded(false)}>
                {tEvents('showLess')}
              </button>
            )}
          </>
        )}
        <Button variant="secondary" size="sm" onClick={onCreateEvent}>
          {t('createEvent')}
        </Button>
      </section>

      <section className={styles.section}>
        <button type="button" className={styles.actionRow} onClick={onShare}>
          {t('shareLink')}
        </button>
        <button type="button" className={`${styles.actionRow} ${styles.dangerAction}`} onClick={onLeave}>
          {t('leaveClassroom')}
        </button>
      </section>
    </div>
  );
}
