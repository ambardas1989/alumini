'use client';

import { useRef, useState } from 'react';
import { MessageType } from '@alumini/types';
import { safeRelativeTime, safeFormatDate } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { UiMessage } from './types';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  message: UiMessage;
  isOwn: boolean;
  /** TASKS_09 TASK 21 FIX C — the sender's role in THIS classroom, looked up from the already-loaded member roster; undefined/null (unknown, or a redacted sender) falls back to the plain short-name format. */
  senderRole?: string | null;
  /** TASKS_09 TASK 25 — used to tell whether the current viewer already responded "I'm there too" to a visiting_city post. */
  currentUserId?: string;
  onDelete: (messageId: string) => void;
  onRetry: (message: UiMessage) => void;
  onImThere?: (messageId: string) => void;
}

const LONG_PRESS_MS = 500;

/** "Rahul Agarwal" → "Rahul A." — single-word names pass through unchanged. */
function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return fullName;
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}

export function MessageBubble({ message, isOwn, senderRole, currentUserId, onDelete, onRetry, onImThere }: MessageBubbleProps) {
  const t = useTranslations('classroom.messages');
  const tRole = useTranslations('status');
  const isStaff = senderRole === 'teacher' || senderRole === 'admin';
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (message.messageType === MessageType.SYSTEM) {
    return (
      <div className={styles.systemRow}>
        <span className={styles.systemText}>
          {message.content} · {safeRelativeTime(message.createdAt)}
        </span>
      </div>
    );
  }

  if (message.isDeleted) {
    return (
      <div className={`${styles.row} ${isOwn ? styles.rowOwn : ''}`}>
        <p className={styles.deletedText}>{t('deleted')}</p>
      </div>
    );
  }

  // TASKS_09 TASK 24 — announcement card. message.isRedacted (set by
  // CorridorService's existing redact-for-unverified-viewer logic, same
  // flag every other message type already uses) is what actually decides
  // blurred-vs-plain here — no separate announcement-specific backend
  // check was needed since the classroom channel already redacts content
  // for an unverified viewer regardless of message type.
  if (message.messageType === MessageType.ANNOUNCEMENT) {
    return (
      <div className={styles.announcementCard}>
        <p className={styles.announcementSenderLine}>
          {message.sender?.fullName ?? '?'} · <span className={styles.announcementTag}>{t('announcementLabel')}</span>
        </p>
        {message.isRedacted ? (
          <>
            <p className={styles.announcementBlurredText} aria-hidden="true">
              {message.content}
            </p>
            <div className={styles.announcementVerifyNudge}>🔒 {t('announcementVerifyNudge')}</div>
          </>
        ) : (
          <p className={styles.announcementText}>{message.content}</p>
        )}
      </div>
    );
  }

  // TASKS_09 TASK 25 — visiting-city card. Same isRedacted-driven blur as
  // the announcement card above.
  if (message.messageType === MessageType.VISITING_CITY) {
    const meta = message.metadata as { city?: string; from_date?: string; to_date?: string; responders?: string[] } | null;
    const responders = meta?.responders ?? [];
    const alreadyResponded = !!currentUserId && responders.includes(currentUserId);
    const dateRange = meta?.from_date && meta?.to_date ? `${safeFormatDate(meta.from_date, { month: 'short', day: 'numeric' })} - ${safeFormatDate(meta.to_date, { month: 'short', day: 'numeric' })}` : '';

    return (
      <div className={styles.visitingCityCard}>
        <p className={styles.visitingCitySenderLine}>{t('visitingCityIsVisiting', { name: message.sender?.fullName ?? '?' })}</p>
        {message.isRedacted ? (
          <>
            <p className={styles.visitingCityBlurred} aria-hidden="true">
              📍 {meta?.city} · {dateRange}
            </p>
            <div className={styles.announcementVerifyNudge}>🔒 {t('announcementVerifyNudge')}</div>
          </>
        ) : (
          <>
            <p className={styles.visitingCityCity}>📍 {meta?.city}</p>
            <p className={styles.visitingCityDates}>{dateRange}</p>
            <div className={styles.visitingCityResponseRow}>
              {!isOwn && (
                <button
                  type="button"
                  className={`${styles.imThereButton} ${alreadyResponded ? styles.imThereButtonActive : ''}`}
                  disabled={alreadyResponded}
                  onClick={() => onImThere?.(message.id)}
                >
                  {alreadyResponded ? t('visitingCityGoing') : t('visitingCityImThere')}
                </button>
              )}
              {responders.length > 0 && <span className={styles.visitingCityResponderCount}>{t('visitingCityResponderCount', { count: responders.length })}</span>}
            </div>
          </>
        )}
      </div>
    );
  }

  const startPress = () => {
    if (!isOwn) return;
    pressTimer.current = setTimeout(() => setConfirmingDelete(true), LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  return (
    <div className={`${styles.row} ${isOwn ? styles.rowOwn : ''}`}>
      {!isOwn && (
        <Avatar
          avatarUrl={message.isRedacted ? null : message.sender?.avatarUrl}
          fullName={message.sender?.fullName ?? '?'}
          sizePx={28}
        />
      )}
      <div className={styles.column}>
        {!isOwn && (
          <p className={`${styles.senderName} ${message.isRedacted ? styles.redactedPill : ''}`}>
            {/* TASKS_09 TASK 21 FIX C — staff show their full name + a role
                pill ("Ghosh Sir · Teacher"); everyone else gets the
                space-saving "First L." short form. Redacted senders keep
                whatever placeholder name they already carry, unshortened —
                shortening a name the viewer can't otherwise verify would
                just add noise. */}
            {message.isRedacted || !message.sender?.fullName
              ? (message.sender?.fullName ?? '?')
              : isStaff
                ? message.sender.fullName
                : shortName(message.sender.fullName)}
            {isStaff && !message.isRedacted && <span className={styles.roleTag}>{tRole(senderRole!)}</span>}
          </p>
        )}
        <div
          className={[
            styles.bubble,
            isOwn ? styles.bubbleOwn : styles.bubbleOther,
            message.isRedacted ? styles.redactedContent : '',
            message.clientStatus === 'sending' ? styles.sending : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
        >
          {message.isRedacted ? (
            <>
              <span className={styles.shimmerBar} style={{ width: '90%' }} />
              <span className={styles.shimmerBar} style={{ width: '65%' }} />
              <span className={styles.shimmerBar} style={{ width: '40%' }} />
            </>
          ) : (
            message.content
          )}
        </div>
        {!message.isRedacted && (
          <div className={styles.metaRow}>
            {!isOwn && <span className={styles.time}>{safeRelativeTime(message.createdAt)}</span>}
            {isOwn && message.clientStatus === 'failed' && (
              <button type="button" className={styles.retryLink} onClick={() => onRetry(message)}>
                {t('sendFailed')}
              </button>
            )}
            {isOwn && message.clientStatus === 'sending' && (
              <span className={styles.time}>{t('sending')}</span>
            )}
            {isOwn && !message.clientStatus && (
              <>
                <span className={styles.time}>{safeRelativeTime(message.createdAt)}</span>
                {/* Always-visible delete trigger — long-press works too (see
                    onPointerDown above), but a touch/mouse gesture alone
                    isn't keyboard-accessible, so this button is the primary
                    affordance and the gesture is a bonus shortcut. */}
                <button
                  type="button"
                  className={styles.deleteTrigger}
                  aria-label={t('deleteMessage')}
                  onClick={() => setConfirmingDelete(true)}
                >
                  ⋯
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {confirmingDelete && (
        <Modal title={t('deleteConfirmTitle')} onClose={() => setConfirmingDelete(false)}>
          <p className={styles.confirmMessage}>{t('deleteConfirmMessage')}</p>
          <div className={styles.confirmActions}>
            <Button variant="ghost" size="md" onClick={() => setConfirmingDelete(false)}>
              {t('deleteCancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete(message.id);
              }}
            >
              {t('deleteConfirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
