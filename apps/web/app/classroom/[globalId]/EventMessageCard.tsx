'use client';

import type { Event as ClassroomEvent, RsvpStatus } from '@alumini/types';
import { safeFormatDate } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import styles from './EventMessageCard.module.css';

interface EventMessageCardProps {
  event: ClassroomEvent | null;
  /** Shown while the event details haven't been fetched/matched yet. */
  fallbackTitle: string;
  onRsvp: (eventId: string, status: RsvpStatus) => void;
}

const RSVP_OPTIONS: RsvpStatus[] = ['going', 'maybe', 'not_going'];

export function EventMessageCard({ event, fallbackTitle, onRsvp }: EventMessageCardProps) {
  const t = useTranslations('classroom.events');

  if (!event) {
    return (
      <div className={styles.card}>
        <p className={styles.title}>{fallbackTitle}</p>
      </div>
    );
  }

  const counts = event.rsvpCounts ?? { going: 0, notGoing: 0, maybe: 0 };

  return (
    <div className={styles.card}>
      {event.channel === 'staff_room' && (
        <span className={`${styles.channelBadge} ${styles.channelBadgeStaffRoom}`}>{t('badge.staff_room')}</span>
      )}
      {event.channel === 'student_alley' && (
        <span className={`${styles.channelBadge} ${styles.channelBadgeStudentAlley}`}>{t('badge.student_alley')}</span>
      )}
      <p className={styles.title}>{event.title}</p>
      <p className={styles.meta}>
        {safeFormatDate(event.eventDate)} · {event.isOnline ? t('online') : event.location || t('online')}
      </p>
      <p className={styles.counts}>
        {t('going')} {counts.going} · {t('maybe')} {counts.maybe} · {t('notGoing')} {counts.notGoing}
      </p>
      <div className={styles.rsvpRow}>
        {RSVP_OPTIONS.map((status) => (
          <button
            key={status}
            type="button"
            className={`${styles.rsvpButton} ${event.userRsvp === status ? styles.rsvpButtonActive : ''}`}
            onClick={() => onRsvp(event.id, status)}
          >
            {t(status === 'going' ? 'going' : status === 'maybe' ? 'maybe' : 'notGoing')}
          </button>
        ))}
      </div>
    </div>
  );
}
