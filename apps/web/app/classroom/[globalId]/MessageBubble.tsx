'use client';

import { useRef, useState } from 'react';
import { MessageType } from '@alumini/types';
import { safeRelativeTime } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { UiMessage } from './types';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  message: UiMessage;
  isOwn: boolean;
  onDelete: (messageId: string) => void;
  onRetry: (message: UiMessage) => void;
}

const LONG_PRESS_MS = 500;

export function MessageBubble({ message, isOwn, onDelete, onRetry }: MessageBubbleProps) {
  const t = useTranslations('classroom.messages');
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
          size="sm"
        />
      )}
      <div className={styles.column}>
        {!isOwn && (
          <p className={`${styles.senderName} ${message.isRedacted ? styles.redactedPill : ''}`}>
            {message.sender?.fullName ?? '?'}
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
