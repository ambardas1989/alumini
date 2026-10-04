'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import tabStyles from './Tab.module.css';
import styles from './SettingsTab.module.css';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const BOARDS = ['CBSE', 'ICSE', 'State', 'IB', 'Other'];
const MEDIUMS = ['English', 'Hindi', 'Regional', 'Other'];

interface SettingsTabProps {
  institutionId: string;
}

/**
 * TASKS_11 TASK 03 — institution profile/branding settings. ADAPTED onto
 * /admin as a new tab (see admin/page.tsx's own comment on why) rather
 * than a separate /institution-admin/[institutionId]/settings route.
 * Logo upload already exists on OverviewTab (TASKS_05 TASK 05) — not
 * duplicated here; this tab covers the fields and cover photo that
 * weren't built yet.
 */
export function SettingsTab({ institutionId }: SettingsTabProps) {
  const t = useTranslations('adminDashboard.settings');
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<api.InstitutionProfile | null>(null);

  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [foundedYear, setFoundedYear] = useState('');
  const [board, setBoard] = useState('');
  const [medium, setMedium] = useState('');
  const [saving, setSaving] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverUploading, setCoverUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getInstitutionProfile(institutionId);
      setProfile(data);
      setAddress(data.address ?? '');
      setWebsite(data.website ?? '');
      setDescription(data.description ?? '');
      setFoundedYear(data.foundedYear ? String(data.foundedYear) : '');
      setBoard(data.board ?? '');
      setMedium(data.medium ?? '');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateInstitutionProfile(institutionId, {
        address: address.trim() || undefined,
        website: website.trim() || undefined,
        description: description.trim() || undefined,
        foundedYear: foundedYear.trim() ? parseInt(foundedYear, 10) : undefined,
        board: board || undefined,
        medium: medium || undefined,
      });
      showToast(t('savedToast'), 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen || !profile) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(chosen.type)) {
      showToast(t('cover.errors.wrongType'), 'error');
      return;
    }
    if (chosen.size > MAX_IMAGE_SIZE_BYTES) {
      showToast(t('cover.errors.tooLarge'), 'error');
      return;
    }

    setCoverUploading(true);
    try {
      const result = await api.uploadInstitutionCoverPhoto(institutionId, chosen);
      setProfile({ ...profile, coverPhotoUrl: result.coverPhotoUrl });
      showToast(t('cover.updatedToast'), 'success');
    } catch (err) {
      const statusCode = err instanceof ApiError ? err.statusCode : null;
      if (statusCode === 413) showToast(t('cover.errors.tooLarge'), 'error');
      else if (statusCode === 415) showToast(t('cover.errors.wrongType'), 'error');
      else showToast(t('cover.errors.uploadFailedGeneric'), 'error');
    } finally {
      setCoverUploading(false);
    }
  };

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorMessage message={error} onRetry={load} fullPage />;
  if (!profile) return null;

  return (
    <>
      <div className={tabStyles.sectionHeader}>
        <span className={tabStyles.sectionLabel}>{t('brandingSection')}</span>
      </div>
      <div className={styles.coverCard}>
        {profile.coverPhotoUrl ? (
          <img src={profile.coverPhotoUrl} alt="" className={styles.coverImage} />
        ) : (
          <div className={styles.coverPlaceholder}>{t('cover.noImage')}</div>
        )}
        <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" className={styles.hiddenInput} onChange={handleCoverFileChange} />
        <Button variant="secondary" size="sm" loading={coverUploading} onClick={() => coverInputRef.current?.click()}>
          {profile.coverPhotoUrl ? t('cover.changeButton') : t('cover.uploadButton')}
        </Button>
      </div>

      <div className={tabStyles.sectionHeader}>
        <span className={tabStyles.sectionLabel}>{t('basicInfoSection')}</span>
      </div>
      <div className={styles.form}>
        <Input label={t('nameLabel')} value={profile.name} disabled />
        <Input label={t('typeLabel')} value={profile.type} disabled />
        <Input label={t('foundedYearLabel')} type="number" value={foundedYear} onChange={(e) => setFoundedYear(e.target.value)} />
        <Select label={t('boardLabel')} value={board} onChange={(e) => setBoard(e.target.value)}>
          <option value="">{t('selectPlaceholder')}</option>
          {BOARDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
        <Select label={t('mediumLabel')} value={medium} onChange={(e) => setMedium(e.target.value)}>
          <option value="">{t('selectPlaceholder')}</option>
          {MEDIUMS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Textarea label={t('addressLabel')} value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
        <Input label={t('websiteLabel')} type="url" value={website} onChange={(e) => setWebsite(e.target.value)} />
        <Textarea
          label={t('descriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={4}
        />
        <Button variant="primary" size="md" fullWidth loading={saving} onClick={handleSave}>
          {t('saveButton')}
        </Button>
      </div>
    </>
  );
}
