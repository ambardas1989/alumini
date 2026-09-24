'use client';

import { useState } from 'react';
import type { ChannelType } from '@alumini/types';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useTranslations } from '@/lib/useTranslations';
import { SheetModal } from '@/components/ui/SheetModal';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './EventCreateModal.module.css';

interface EventCreateModalProps {
  classroomId: string;
  /** TASKS_08 TASK 05 — pre-selected from the tab the "+" button was pressed on; the event is created into this channel. */
  channel: ChannelType;
  onClose: () => void;
  onCreated: () => void;
}

export function EventCreateModal({ classroomId, channel, onClose, onCreated }: EventCreateModalProps) {
  const t = useTranslations('classroom.eventCreate');

  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && eventDate.length > 0 && !dateError;

  const handleDateChange = (value: string) => {
    setEventDate(value);
    setDateError(value && new Date(value).getTime() <= Date.now() ? t('dateMustBeFuture') : null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createEvent(classroomId, {
        title: title.trim(),
        eventDate: new Date(eventDate).toISOString(),
        location: isOnline ? undefined : location.trim() || undefined,
        description: description.trim() || undefined,
        isOnline,
        channel,
      });
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <SheetModal title={t('title')} onClose={onClose}>
      <div className={styles.form}>
        <p className={styles.visibilityLabel}>{t(`visibleTo.${channel}`)}</p>
        <Input label={t('titleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input
          label={t('dateLabel')}
          type="datetime-local"
          value={eventDate}
          error={dateError ?? undefined}
          onChange={(e) => handleDateChange(e.target.value)}
        />
        <Switch label={t('onlineLabel')} checked={isOnline} onChange={setIsOnline} />
        {!isOnline && (
          <Input label={t('locationLabel')} value={location} onChange={(e) => setLocation(e.target.value)} />
        )}
        <Textarea
          label={t('descriptionLabel')}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {error && <ErrorMessage message={error} />}

        <Button variant="primary" size="lg" fullWidth disabled={!canSubmit} loading={submitting} onClick={handleSubmit}>
          {t('createButton')}
        </Button>
      </div>
    </SheetModal>
  );
}
