'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from '@/lib/useTranslations';
import { useToast } from '@/components/providers/ToastProvider';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

const MAX_ROWS = 4;

export function MessageInput({ onSend, disabled = false }: MessageInputProps) {
  const t = useTranslations('classroom.messages');
  const { showToast } = useToast();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '20');
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    requestAnimationFrame(autoGrow);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.bar}>
      {/* TASKS_09 TASK 21 FIX E — attachments themselves are TASKS_08 TASK 09, deferred; this is just the entry point + a "coming soon" toast. */}
      <button
        type="button"
        className={styles.attachButton}
        onClick={() => showToast(t('attachmentComingSoon'), 'info')}
        aria-label={t('attach')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.6-2.6l8.49-8.48" />
        </svg>
      </button>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        rows={1}
        placeholder={t('inputPlaceholder')}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          autoGrow();
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={styles.sendButton}
        disabled={disabled || !value.trim()}
        onClick={handleSend}
        aria-label={t('send')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}
