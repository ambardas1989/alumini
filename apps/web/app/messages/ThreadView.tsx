'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import type { DmMessage, StudentProfile } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate, safeRelativeTime } from '@/lib/format';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/lib/useTranslations';
import { useToast } from '@/components/providers/ToastProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import styles from './ThreadView.module.css';

const MAX_ROWS = 3;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

interface ThreadViewProps {
  userId: string;
}

export function ThreadView({ userId }: ThreadViewProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const t = useTranslations('messages.thread');

  const [recipient, setRecipient] = useState<StudentProfile | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [value, setValue] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [profile, thread] = await Promise.all([
          api.getStudentProfile(userId),
          api.getDmMessages(userId, 0),
        ]);
        if (cancelled) return;
        setRecipient(profile);
        setMessages(thread);
        api.markDmRead(userId).catch(() => {});
      } catch (err) {
        if (!cancelled) showToast(getErrorMessage(err), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [loading, messages.length]);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '20');
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };

  const handleSend = async () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      const sent = await api.sendDmMessage(userId, trimmed);
      setMessages((prev) => [...prev, sent]);
      setValue('');
      requestAnimationFrame(autoGrow);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const recipientName = recipient?.fullName ?? '';

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={() => router.push('/messages')} aria-label={t('back')}>
          ←
        </button>
        <Avatar avatarUrl={recipient?.avatarUrl ?? null} fullName={recipientName || '?'} size="md" />
        <p className={styles.name}>{recipientName}</p>
      </header>

      <div className={styles.messages}>
        {loading && (
          <div className={styles.loadingWrap}>
            <LoadingSpinner size="md" />
          </div>
        )}

        {!loading &&
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDateSeparator = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const isOwn = m.senderId === user?.id;

            return (
              <div key={m.id}>
                {showDateSeparator && (
                  <div className={styles.dateSeparator}>
                    <span>{safeFormatDate(m.createdAt)}</span>
                  </div>
                )}
                <div className={`${styles.row} ${isOwn ? styles.rowOwn : ''}`}>
                  <div className={styles.column}>
                    {!isOwn && <p className={styles.senderName}>{recipientName}</p>}
                    <div className={`${styles.bubble} ${isOwn ? styles.bubbleOwn : styles.bubbleOther}`}>
                      {m.content}
                    </div>
                    <span className={styles.time}>{safeRelativeTime(m.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        <div ref={bottomRef} />
      </div>

      <div className={styles.inputBar}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          placeholder={t('inputPlaceholder')}
          value={value}
          disabled={sending}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={styles.sendButton}
          disabled={sending || !value.trim()}
          onClick={handleSend}
          aria-label={t('send')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
