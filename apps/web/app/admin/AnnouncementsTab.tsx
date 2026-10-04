'use client';

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { safeFormatDate } from '@/lib/format';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import tabStyles from './Tab.module.css';
import styles from './AnnouncementsTab.module.css';

interface AnnouncementsTabProps {
  institutionId: string;
}

type Target = 'all' | 'specific';

/** TASKS_11 TASK 08 — ADAPTED onto /admin as a new tab (see page.tsx's own comment) rather than a separate /institution-admin/[institutionId]/announcements route. Read-only after send — no edit route exists, same as the task's own spec. */
export function AnnouncementsTab({ institutionId }: AnnouncementsTabProps) {
  const t = useTranslations('adminDashboard.announcements');
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<api.InstitutionAnnouncement[]>([]);
  const [classrooms, setClassrooms] = useState<api.AdminClassroomEntry[]>([]);

  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<Target>('all');
  const [selectedClassroomIds, setSelectedClassroomIds] = useState<string[]>([]);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, yearGroups] = await Promise.all([
        api.listInstitutionAnnouncements(institutionId),
        api.getClassrooms(institutionId),
      ]);
      setAnnouncements(rows);
      setClassrooms(yearGroups.flatMap((g) => g.classrooms));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshRecipientCount = useCallback(
    async (nextTarget: Target, nextClassroomIds: string[]) => {
      if (nextTarget === 'specific' && nextClassroomIds.length === 0) {
        setRecipientCount(0);
        return;
      }
      try {
        const result = await api.getAnnouncementRecipientCount(
          institutionId,
          nextTarget,
          nextTarget === 'specific' ? nextClassroomIds : undefined,
        );
        setRecipientCount(result.recipientCount);
      } catch {
        setRecipientCount(null);
      }
    },
    [institutionId],
  );

  const handleOpenCompose = () => {
    setComposeOpen(true);
    setTitle('');
    setBody('');
    setTarget('all');
    setSelectedClassroomIds([]);
    refreshRecipientCount('all', []);
  };

  const handleTargetChange = (next: Target) => {
    setTarget(next);
    refreshRecipientCount(next, selectedClassroomIds);
  };

  const toggleClassroom = (classroomId: string) => {
    const next = selectedClassroomIds.includes(classroomId)
      ? selectedClassroomIds.filter((id) => id !== classroomId)
      : [...selectedClassroomIds, classroomId];
    setSelectedClassroomIds(next);
    refreshRecipientCount(target, next);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      await api.sendInstitutionAnnouncement(institutionId, {
        title: title.trim(),
        body: body.trim(),
        target,
        targetClassroomIds: target === 'specific' ? selectedClassroomIds : undefined,
      });
      showToast(t('sentToast'), 'success');
      setComposeOpen(false);
      setConfirming(false);
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSending(false);
    }
  };

  const canSend = title.trim().length > 0 && body.trim().length > 0 && (target === 'all' || selectedClassroomIds.length > 0);

  if (loading) {
    return (
      <>
        <SkeletonCard />
        <SkeletonCard />
      </>
    );
  }

  if (error) return <ErrorMessage message={error} onRetry={load} fullPage />;

  return (
    <>
      <div className={tabStyles.sectionHeader}>
        <span className={tabStyles.sectionLabel}>{t('pastAnnouncements')}</span>
        <Button variant="primary" size="sm" onClick={handleOpenCompose}>
          {t('newCta')}
        </Button>
      </div>

      {announcements.length === 0 ? (
        <EmptyState icon="📣" title={t('empty.title')} description={t('empty.description')} />
      ) : (
        announcements.map((a) => (
          <div key={a.id} className={styles.card}>
            <p className={styles.title}>{a.title}</p>
            <p className={styles.preview}>{a.body}</p>
            <p className={styles.meta}>
              {safeFormatDate(a.sent_at)} · {t('recipientCount', { count: a.recipient_count })}
            </p>
          </div>
        ))
      )}

      {composeOpen && (
        <Modal title={t('composeModal.title')} onClose={() => setComposeOpen(false)}>
          <Input label={t('composeModal.titleLabel')} value={title} onChange={(e) => setTitle(e.target.value.slice(0, 100))} maxLength={100} />
          <Textarea
            label={t('composeModal.bodyLabel')}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 1000))}
            maxLength={1000}
            rows={5}
          />

          <p className={styles.radioLabel}>{t('composeModal.targetLabel')}</p>
          <div className={styles.radioRow} role="radiogroup" aria-label={t('composeModal.targetLabel')}>
            <button
              type="button"
              role="radio"
              aria-checked={target === 'all'}
              className={`chip ${target === 'all' ? 'chip-active' : ''}`}
              onClick={() => handleTargetChange('all')}
            >
              {t('composeModal.targetAll')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={target === 'specific'}
              className={`chip ${target === 'specific' ? 'chip-active' : ''}`}
              onClick={() => handleTargetChange('specific')}
            >
              {t('composeModal.targetSpecific')}
            </button>
          </div>

          {target === 'specific' && (
            <div className={styles.classroomPicker}>
              {classrooms.map((c) => (
                <label key={c.id} className={styles.classroomOption}>
                  <input
                    type="checkbox"
                    checked={selectedClassroomIds.includes(c.id)}
                    onChange={() => toggleClassroom(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}

          <p className={styles.recipientPreview}>
            {recipientCount === null ? t('composeModal.recipientUnknown') : t('composeModal.recipientPreview', { count: recipientCount })}
          </p>

          <Button variant="primary" size="md" fullWidth disabled={!canSend} onClick={() => setConfirming(true)}>
            {t('composeModal.sendCta')}
          </Button>
        </Modal>
      )}

      {confirming && (
        <Modal title={t('confirmModal.title')} onClose={() => setConfirming(false)}>
          <p className={styles.confirmText}>{t('confirmModal.message', { count: recipientCount ?? 0 })}</p>
          <div className={styles.confirmActions}>
            <Button variant="secondary" size="md" onClick={() => setConfirming(false)}>
              {t('confirmModal.cancel')}
            </Button>
            <Button variant="primary" size="md" loading={sending} onClick={handleSend}>
              {t('confirmModal.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
