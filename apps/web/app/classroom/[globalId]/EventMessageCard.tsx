'use client';

import type { Event as ClassroomEvent, RsvpStatus } from '@alumini/types';
import { safeFormatDate } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { Avatar } from '@/components/ui/Avatar';
import styles from './EventMessageCard.module.css';

interface EventMessageCardProps {
  event: ClassroomEvent | null;
  /** Shown while the event details haven't been fetched/matched yet. */
  fallbackTitle: string;
  onOpen: (eventId: string) => void;
  /** TASKS_09 TASK 21 FIX D — the card's own quick RSVP pills, distinct from onOpen (tapping the card body/header still opens the full detail sheet). */
  onQuickRsvp: (eventId: string, status: RsvpStatus) => void;
}

const MAX_ATTENDEE_AVATARS = 4;

/** TASKS_09 TASK 21 FIX D — chat event card matching the mockup exactly: dark header bar, white body, overlapping "going" avatars, and quick Going/Pass/Maybe pills (tapping the card itself still opens the full RSVP detail sheet via onOpen). */
export function EventMessageCard({ event, fallbackTitle, onOpen, onQuickRsvp }: EventMessageCardProps) {
  const t = useTranslations('classroom.events');

  if (!event) {
    return (
      <div className={styles.card}>
        <p className={styles.title}>{fallbackTitle}</p>
      </div>
    );
  }

  const counts = event.rsvpCounts ?? { going: 0, notGoing: 0, maybe: 0 };
  const attendees = event.goingAttendees ?? [];
  const overflow = counts.going - attendees.length;
  const locationLine = event.isOnline ? t('online') : event.location;
  const creatorFirstName = event.createdByName?.split(/\s+/)[0] ?? '';

  const stopAndRsvp = (e: React.MouseEvent, status: RsvpStatus) => {
    e.stopPropagation();
    onQuickRsvp(event.id, status);
  };

  return (
    <div className={styles.chatCard} onClick={() => onOpen(event.id)}>
      <div className={styles.chatCardHeader}>
        <span aria-hidden="true">🎉</span>
        <span>{t('chatCard.headerLabel', { name: creatorFirstName })}</span>
      </div>
      <div className={styles.chatCardBody}>
        <p className={styles.chatCardTitle}>{event.title}</p>
        <p className={styles.chatCardMeta}>
          📅 {safeFormatDate(event.eventDate, { day: 'numeric', month: 'long', year: 'numeric' })}
          {locationLine ? ` · 📍 ${locationLine}` : ''}
        </p>

        <div className={styles.attendeeRow}>
          {attendees.length > 0 && (
            <div className={styles.attendeeAvatars}>
              {attendees.slice(0, MAX_ATTENDEE_AVATARS).map((attendee, i) => (
                <span key={attendee.id} className={styles.attendeeAvatar} style={{ zIndex: MAX_ATTENDEE_AVATARS - i, marginInlineStart: i === 0 ? 0 : -8 }}>
                  <Avatar avatarUrl={attendee.avatarUrl} fullName={attendee.fullName} sizePx={24} />
                </span>
              ))}
            </div>
          )}
          {overflow > 0 && <span className={styles.attendeeOverflow}>+{overflow}</span>}
          {counts.going > 0 && <span className={styles.goingCount}>{t('goingCount', { count: counts.going })}</span>}

          <div className={styles.rsvpPills}>
            <button
              type="button"
              className={`${styles.rsvpPill} ${styles.rsvpPillGoing} ${event.userRsvp === 'going' ? styles.rsvpPillActive : ''}`}
              onClick={(e) => stopAndRsvp(e, 'going' as RsvpStatus)}
            >
              {t('chatCard.goingPill')}
            </button>
            <button
              type="button"
              className={`${styles.rsvpPill} ${event.userRsvp === 'not_going' ? styles.rsvpPillActiveNeutral : ''}`}
              onClick={(e) => stopAndRsvp(e, 'not_going' as RsvpStatus)}
            >
              {t('chatCard.passPill')}
            </button>
            <button
              type="button"
              className={`${styles.rsvpPill} ${styles.rsvpPillMaybe} ${event.userRsvp === 'maybe' ? styles.rsvpPillActive : ''}`}
              onClick={(e) => stopAndRsvp(e, 'maybe' as RsvpStatus)}
            >
              {t('chatCard.maybePill')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
