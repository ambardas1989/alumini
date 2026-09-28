'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from '@/lib/useTranslations';
import { useToast } from '@/components/providers/ToastProvider';
import { safeFormatDate } from '@/lib/format';
import styles from './MessageInput.module.css';

export interface VisitingCityInput {
  city: string;
  fromDate: string;
  toDate: string;
}

interface MessageInputProps {
  /** TASKS_09 TASK 24/25 — isAnnouncement/visitingCity are only ever set when this compose box's own matching mode is active. */
  onSend: (content: string, isAnnouncement?: boolean, visitingCity?: VisitingCityInput) => void;
  disabled?: boolean;
}

const MAX_ROWS = 4;

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * TASKS_09 TASK 24/25 — MessageInput only ever renders when the caller can
 * already post in this channel (page.tsx's canPostActive gate), and
 * posting in ANY channel already requires verification_status='verified'
 * (MembershipService.canAccessChannel()) — so "Announcement/Visiting a
 * city are verified-members-and-admins-only" is already true for every
 * render of this component without a separate prop/check.
 */
export function MessageInput({ onSend, disabled = false }: MessageInputProps) {
  const t = useTranslations('classroom.messages');
  const { showToast } = useToast();
  const [value, setValue] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isAnnouncementMode, setIsAnnouncementMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // TASKS_09 TASK 25 — visiting-city inline form, replacing the normal bar
  // while open (its 3 fields don't fit into the single-line text input the
  // way announcement mode's does).
  const [showVisitingCityForm, setShowVisitingCityForm] = useState(false);
  const [vcCity, setVcCity] = useState('');
  const [vcFromDate, setVcFromDate] = useState(todayIso());
  const [vcToDate, setVcToDate] = useState(todayIso(2));

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

  const closeVisitingCityForm = () => {
    setShowVisitingCityForm(false);
    setVcCity('');
    setVcFromDate(todayIso());
    setVcToDate(todayIso(2));
  };

  const canShareVisitingCity = !!vcCity.trim() && !!vcFromDate && !!vcToDate;

  const handleShareVisitingCity = () => {
    if (!canShareVisitingCity || disabled) return;
    const content = t('visitingCity.fallbackContent', {
      city: vcCity.trim(),
      from: safeFormatDate(vcFromDate, { month: 'short', day: 'numeric' }),
      to: safeFormatDate(vcToDate, { month: 'short', day: 'numeric' }),
    });
    onSend(content, false, { city: vcCity.trim(), fromDate: vcFromDate, toDate: vcToDate });
    closeVisitingCityForm();
  };

  if (showVisitingCityForm) {
    return (
      <div className={styles.wrap}>
        <div className={styles.visitingCityForm}>
          <div className={styles.visitingCityHeader}>
            <span className={styles.announcementLabel}>{t('visitingCity.formLabel')}</span>
            <button type="button" className={styles.announcementCancel} onClick={closeVisitingCityForm} aria-label={t('visitingCity.cancel')}>
              ✕
            </button>
          </div>
          <input
            type="text"
            className={styles.visitingCityInput}
            placeholder={t('visitingCity.cityPlaceholder')}
            value={vcCity}
            onChange={(e) => setVcCity(e.target.value)}
          />
          <div className={styles.visitingCityDateRow}>
            <input type="date" className={styles.visitingCityInput} value={vcFromDate} onChange={(e) => setVcFromDate(e.target.value)} />
            <input type="date" className={styles.visitingCityInput} value={vcToDate} onChange={(e) => setVcToDate(e.target.value)} />
          </div>
          <button type="button" className={styles.visitingCityShareButton} disabled={!canShareVisitingCity} onClick={handleShareVisitingCity}>
            {t('visitingCity.shareButton')}
          </button>
        </div>
      </div>
    );
  }

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
          {/* TASKS_09 TASK 21 FIX E / TASKS_09 TASK 24/25 — attachments themselves are still TASKS_08 TASK 09, deferred; Photo/File stay "coming soon" toasts, Announcement/Visiting a city are the functional menu items. */}
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
                <button
                  type="button"
                  className={`${styles.attachMenuItem} ${styles.attachMenuItemPro}`}
                  onClick={() => {
                    setShowAttachMenu(false);
                    setShowVisitingCityForm(true);
                  }}
                >
                  📍 {t('attachMenu.visitingCity')}
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
