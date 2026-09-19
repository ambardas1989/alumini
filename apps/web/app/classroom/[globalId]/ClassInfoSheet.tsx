'use client';

import type { Event as ClassroomEvent } from '@alumini/types';
import { formatDate } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import styles from './ClassInfoSheet.module.css';

interface MemberAvatar {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
}

interface ClassInfoSheetProps {
  classroomName: string;
  institutionName: string;
  memberCount: number;
  memberPreview: MemberAvatar[];
  upcomingEvents: ClassroomEvent[];
  onViewAllMembers: () => void;
  onCreateEvent: () => void;
  onShare: () => void;
  onLeave: () => void;
}

const PREVIEW_LIMIT = 8;

export function ClassInfoSheet({
  classroomName,
  institutionName,
  memberCount,
  memberPreview,
  upcomingEvents,
  onViewAllMembers,
  onCreateEvent,
  onShare,
  onLeave,
}: ClassInfoSheetProps) {
  const t = useTranslations('classroom.infoSheet');
  const visible = memberPreview.slice(0, PREVIEW_LIMIT);
  const overflow = memberCount - visible.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <p className={styles.name}>{classroomName}</p>
        <p className={styles.institution}>{institutionName}</p>
      </div>

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
          <ul className={styles.eventList}>
            {upcomingEvents.map((event) => (
              <li key={event.id} className={styles.eventRow}>
                <span className={styles.eventTitle}>{event.title}</span>
                <span className={styles.eventDate}>{formatDate(event.eventDate)}</span>
              </li>
            ))}
          </ul>
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
