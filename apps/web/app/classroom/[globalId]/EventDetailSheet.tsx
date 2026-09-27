'use client';

import { useEffect, useState } from 'react';
import type { RsvpStatus } from '@alumini/types';
import * as api from '@/lib/api';
import type { EventDetail, RsvpSummary } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate } from '@/lib/format';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { Avatar } from '@/components/ui/Avatar';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './EventDetailSheet.module.css';

interface EventDetailSheetProps {
  classroomId: string;
  eventId: string;
  /** Bumps the caller's own event map (EventTile badges, ClassInfoSheet list) in sync with what's RSVPed here, without that caller re-fetching the whole list. */
  onRsvpChanged: (eventId: string, rsvps: RsvpSummary) => void;
  onClose: () => void;
}

const RSVP_OPTIONS: RsvpStatus[] = ['going', 'maybe', 'not_going'];

/** TASKS_09 TASK 16 — event detail bottom sheet: full info + 3-button RSVP with optimistic updates. */
export function EventDetailSheet({ classroomId, eventId, onRsvpChanged, onClose }: EventDetailSheetProps) {
  const t = useTranslations('classroom.events.detail');
  const tEvents = useTranslations('classroom.events');
  const { showToast } = useToast();

  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Buttons show whenever the caller hasn't RSVPed yet, or after they tap
  // "Change my response" to re-open them over their current status.
  const [showButtons, setShowButtons] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    api
      .getEventDetail(classroomId, eventId)
      .then((data) => {
        setDetail(data);
        setShowButtons(!data.rsvps.myRsvp);
      })
      .catch((err) => setLoadError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [classroomId, eventId]);

  const handleRsvp = async (status: RsvpStatus) => {
    if (!detail || saving) return;
    setSaving(true);
    const previous = detail.rsvps;
    // Optimistic — highlight the tapped button immediately.
    setDetail((prev) => (prev ? { ...prev, rsvps: { ...prev.rsvps, myRsvp: status } } : prev));
    setShowButtons(false);
    try {
      const rsvps = await api.rsvpEvent(classroomId, eventId, status);
      setDetail((prev) => (prev ? { ...prev, rsvps } : prev));
      onRsvpChanged(eventId, rsvps);
    } catch (err) {
      setDetail((prev) => (prev ? { ...prev, rsvps: previous } : prev));
      setShowButtons(true);
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenMap = () => {
    if (!detail?.location) return;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detail.location)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label={t('close')}>
        ✕
      </button>

      {loading && (
        <div className={styles.centeredLoading}>
          <LoadingSpinner size="md" />
        </div>
      )}

      {loadError && !loading && <ErrorMessage message={loadError} onRetry={load} />}

      {detail && !loading && !loadError && (
        <>
          <h2 className={styles.title}>{detail.title}</h2>

          <p className={styles.metaRow}>
            <span aria-hidden="true">🕐</span>
            {safeFormatDate(detail.eventDate, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          </p>

          {detail.isOnline ? (
            <p className={styles.metaRow}>
              <span aria-hidden="true">📍</span> {tEvents('online')}
            </p>
          ) : detail.location ? (
            <button type="button" className={styles.metaRowLink} onClick={handleOpenMap}>
              <span aria-hidden="true">📍</span> {detail.location}
            </button>
          ) : null}

          {detail.description && <p className={styles.description}>{detail.description}</p>}

          <div className={styles.creatorRow}>
            <Avatar avatarUrl={detail.createdBy.avatarUrl} fullName={detail.createdBy.fullName ?? '?'} size="sm" />
            <span className={styles.creatorName}>{t('createdBy', { name: detail.createdBy.fullName ?? '' })}</span>
          </div>

          <div className={styles.rsvpSection}>
            {showButtons ? (
              <div className={styles.rsvpButtons}>
                {RSVP_OPTIONS.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={saving}
                    className={`${styles.rsvpButton} ${detail.rsvps.myRsvp === status ? styles.rsvpButtonActive : ''} ${styles[`rsvpButton_${status}`]}`}
                    onClick={() => handleRsvp(status)}
                  >
                    {t(status === 'going' ? 'goingButton' : status === 'maybe' ? 'maybeButton' : 'cantGoButton')}
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" className={styles.changeResponseLink} onClick={() => setShowButtons(true)}>
                {t('changeResponse')}
              </button>
            )}

            <p className={styles.rsvpCounts}>
              {t('rsvpSummary', { going: detail.rsvps.going, maybe: detail.rsvps.maybe, notGoing: detail.rsvps.notGoing })}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
