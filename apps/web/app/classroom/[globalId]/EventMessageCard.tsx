'use client';

import type { Event as ClassroomEvent } from '@alumini/types';
import { EventTile } from './EventTile';
import styles from './EventMessageCard.module.css';

interface EventMessageCardProps {
  event: ClassroomEvent | null;
  /** Shown while the event details haven't been fetched/matched yet. */
  fallbackTitle: string;
  onOpen: (eventId: string) => void;
}

/** TASKS_09 TASK 16 — chat event cards are now the same compact, tappable EventTile used everywhere else. */
export function EventMessageCard({ event, fallbackTitle, onOpen }: EventMessageCardProps) {
  if (!event) {
    return (
      <div className={styles.card}>
        <p className={styles.title}>{fallbackTitle}</p>
      </div>
    );
  }

  return <EventTile event={event} showChannelBadge onOpen={onOpen} />;
}
