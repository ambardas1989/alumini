'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from '@/lib/useTranslations';
import { useToast } from '@/components/providers/ToastProvider';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  /** TASKS_09 TASK 24 — isAnnouncement is only ever true when this compose box's own "Announcement" mode is active. */
  onSend: (content: string, isAnnouncement?: boolean) => void;
  disabled?: boolean;
}

const MAX_ROWS = 4;

/**
 * TASKS_09 TASK 24 — MessageInput only ever renders when the caller can
 * already post in this channel (page.tsx's canPostActive gate), and
 * posting in ANY channel already requires verification_status='verified'
 * (MembershipService.canAccessChannel()) — so "Announcement is verified-
 * members-and-admins-only" is already true for every render of this
 * component without a separate prop/check.
 */
export function MessageInput({ onSend, disabled = false }: MessageInputProps) {
  const t = useTranslations('classroom.messages');
  const { showToast } = useToast();
  const [value, setValue] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isAnnouncementMode, setIsAnnouncementMode] = useState(false);
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
    onSend(trimmed, isAnnouncementMode);
    setValue('');
    setIsAnnouncementMode(false);
    requestAnimationFrame(autoGrow);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.wrap}>
      {isAnnouncementMode && (
        <div className={styles.announcementLabelRow}>
          <span className={styles.announcementLabel}>{t('announcementMode.label')}</span>
          <button type="button" className={styles.announcementCancel} onClick={() => setIsAnnouncementMode(false)} aria-label={t('announcementMode.cancel')}>
            ✕
          </button>
        </div>
      )}

      <div className={`${styles.bar} ${isAnnouncementMode ? styles.barAnnouncement : ''}`}>
        <div className={styles.attachWrap}>
          {/* TASKS_09 TASK 21 FIX E / TASKS_09 TASK 24 — attachments themselves are still TASKS_08 TASK 09, deferred; Photo/File stay "coming soon" toasts, Announcement is the one functional menu item. */}
          <button
            type="button"
            className={styles.attachButton}
            onClick={() => setShowAttachMenu((prev) => !prev)}
            aria-label={t('attach')}
            aria-expanded={showAttachMenu}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          {showAttachMenu && (
            <>
              <button type="button" className={styles.menuBackdrop} aria-label={t('attach')} onClick={() => setShowAttachMenu(false)} />
              <div className={styles.attachMenu}>
                <button
                  type="button"
                  className={styles.attachMenuItem}
                  onClick={() => {
                    setShowAttachMenu(false);
                    showToast(t('attachmentComingSoon'), 'info');
                  }}
                >
                  📷 {t('attachMenu.photo')}
                </button>
                <button
                  type="button"
                  className={styles.attachMenuItem}
                  onClick={() => {
                    setShowAttachMenu(false);
                    showToast(t('attachmentComingSoon'), 'info');
                  }}
                >
                  📎 {t('attachMenu.file')}
                </button>
                <button
                  type="button"
                  className={`${styles.attachMenuItem} ${styles.attachMenuItemPro}`}
                  onClick={() => {
                    setShowAttachMenu(false);
                    setIsAnnouncementMode(true);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                >
                  📢 {t('attachMenu.announcement')}
                </button>
              </div>
            </>
          )}
        </div>

        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          placeholder={isAnnouncementMode ? t('announcementMode.placeholder') : t('inputPlaceholder')}
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
    </div>
  );
}
