'use client';

import type { Event as ClassroomEvent } from '@alumini/types';
import { safeFormatDate } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import styles from './EventTile.module.css';

interface EventTileProps {
  event: ClassroomEvent;
  /** Chat context only — ClassInfoSheet's list is already role/channel-scoped, so it omits this. */
  showChannelBadge?: boolean;
  onOpen: (eventId: string) => void;
}

/** TASKS_09 TASK 16 — compact 3-line event tile, tappable → opens the full detail sheet. */
export function EventTile({ event, showChannelBadge, onOpen }: EventTileProps) {
  const t = useTranslations('classroom.events');
  const counts = event.rsvpCounts ?? { going: 0, notGoing: 0, maybe: 0 };
  const locationLine = event.isOnline ? t('online') : event.location;

  const statusIcon =
    event.userRsvp === 'going' ? (
      <span className={`${styles.statusIcon} ${styles.statusGoing}`}>✓</span>
    ) : event.userRsvp === 'maybe' ? (
      <span className={`${styles.statusIcon} ${styles.statusMaybe}`}>?</span>
    ) : event.userRsvp === 'not_going' ? (
      <span className={`${styles.statusIcon} ${styles.statusNotGoing}`}>✗</span>
    ) : (
      <span className={`${styles.statusIcon} ${styles.statusNone}`}>+</span>
    );

  return (
    <button type="button" className={styles.tile} onClick={() => onOpen(event.id)}>
      {showChannelBadge && event.channel === 'staff_room' && (
        <span className={`${styles.channelBadge} ${styles.channelBadgeStaffRoom}`}>{t('badge.staff_room')}</span>
      )}
      {showChannelBadge && event.channel === 'student_alley' && (
        <span className={`${styles.channelBadge} ${styles.channelBadgeStudentAlley}`}>{t('badge.student_alley')}</span>
      )}
      <div className={styles.line1}>
        <span className={styles.title}>{event.title}</span>
        {statusIcon}
      </div>
      <p className={styles.line2}>
        🕐 {safeFormatDate(event.eventDate, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
        {counts.going > 0 && ` · 👥 ${t('goingCount', { count: counts.going })}`}
      </p>
      {locationLine && <p className={styles.line3}>📍 {locationLine}</p>}
    </button>
  );
}
