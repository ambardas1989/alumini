'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { appConfig } from '@/lib/brand';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterChips } from '@/components/ui/FilterChips';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import styles from './ClassroomsTab.module.css';

interface ClassroomsTabProps {
  institutionId: string;
}

interface FlatClassroom extends api.AdminClassroomEntry {
  isActive: boolean;
}

type Filter = 'active' | 'alumni';
type StatusTab = 'active' | 'archived';

/**
 * TASK 11 TAB 3. Reuses GET /admin/:institutionId/classrooms — the same
 * endpoint OverviewTab/CodesTab already call — grouped by batch year; a
 * classroom's "Active" vs "Alumni" status is derived from its group's year
 * against the identical threshold ClassroomService.getMyClassrooms() uses
 * for isActive, not a second, possibly-drifting definition invented here.
 * No "last active time" per classroom — nothing in the schema tracks that
 * (would need a per-classroom last-message timestamp this endpoint has
 * never returned), so it's left out rather than faked.
 *
 * TASKS_11 TASK 07 — added create/edit/archive. "Active"/"Archived" status
 * tabs here are a SEPARATE concept from the pre-existing "Active"/"Alumni"
 * year-based filter above: a classroom from a recent batch year can still
 * be explicitly archived by an admin, and an old one that was never
 * archived stays visible under "Active".
 */
export function ClassroomsTab({ institutionId }: ClassroomsTabProps) {
  const t = useTranslations('adminDashboard.classrooms');
  const tOverview = useTranslations('adminDashboard.overview');
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<FlatClassroom[]>([]);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [statusTab, setStatusTab] = useState<StatusTab>('active');

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createBatchYear, setCreateBatchYear] = useState(String(new Date().getFullYear()));
  const [createGrade, setCreateGrade] = useState('');
  const [createSection, setCreateSection] = useState('');
  const [createProgram, setCreateProgram] = useState('');
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<FlatClassroom | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState<FlatClassroom | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const yearGroups = await api.getClassrooms(institutionId);
      const activeYearThreshold = new Date().getFullYear() - appConfig.CLASSROOM_ACTIVE_YEAR_WINDOW;
      const flat = yearGroups.flatMap((group) =>
        group.classrooms.map((c) => ({ ...c, isActive: group.year >= activeYearThreshold })),
      );
      setClassrooms(flat);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let result = classrooms.filter((c) => (statusTab === 'archived' ? !!c.archivedAt : !c.archivedAt));
    if (filter === 'active') result = result.filter((c) => c.isActive);
    if (filter === 'alumni') result = result.filter((c) => !c.isActive);
    return result;
  }, [classrooms, filter, statusTab]);

  const handleCreate = async () => {
    if (!createName.trim() || !createBatchYear.trim()) return;
    setCreating(true);
    try {
      await api.createClassroomForInstitution(institutionId, {
        name: createName.trim(),
        batchYear: parseInt(createBatchYear, 10),
        grade: createGrade.trim() || undefined,
        section: createSection.trim() || undefined,
        program: createProgram.trim() || undefined,
      });
      showToast(t('create.successToast'), 'success');
      setCreateOpen(false);
      setCreateName('');
      setCreateGrade('');
      setCreateSection('');
      setCreateProgram('');
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editTarget || !editName.trim()) return;
    setSaving(true);
    try {
      await api.updateClassroomForInstitution(institutionId, editTarget.id, { name: editName.trim() });
      showToast(t('edit.successToast'), 'success');
      setClassrooms((prev) => prev.map((c) => (c.id === editTarget.id ? { ...c, name: editName.trim() } : c)));
      setEditTarget(null);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await api.archiveClassroomForInstitution(institutionId, archiveTarget.id);
      showToast(t('archive.successToast'), 'success');
      setClassrooms((prev) => prev.map((c) => (c.id === archiveTarget.id ? { ...c, archivedAt: new Date().toISOString() } : c)));
      setArchiveTarget(null);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setArchiving(false);
    }
  };

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
      <div className={styles.topRow}>
        <div className={styles.statusTabs}>
          <button
            type="button"
            className={`${styles.statusTab} ${statusTab === 'active' ? styles.statusTabActive : ''}`}
            onClick={() => setStatusTab('active')}
          >
            {t('statusTabs.active')}
          </button>
          <button
            type="button"
            className={`${styles.statusTab} ${statusTab === 'archived' ? styles.statusTabActive : ''}`}
            onClick={() => setStatusTab('archived')}
          >
            {t('statusTabs.archived')}
          </button>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          {t('create.cta')}
        </Button>
      </div>

      <FilterChips
        options={[
          { value: 'active', label: t('filter.active') },
          { value: 'alumni', label: t('filter.alumni') },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as Filter | null)}
        allLabel={t('filter.all')}
      />

      {filtered.length === 0 ? (
        <EmptyState icon="🏫" title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className={styles.list}>
          {filtered.map((c) => (
            <div key={c.id} className="card">
              <div className={styles.row}>
                <p className={styles.name}>{c.name}</p>
                <span className={styles.globalId}>{c.globalId}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.meta}>
                  {tOverview('memberSummary', { verified: c.verifiedCount, pending: c.pendingCount, total: c.memberCount })}
                </span>
              </div>
              <div className={styles.actionsRow}>
                <Link href={`/classroom/${c.globalId}`} className={styles.viewLink}>
                  {t('viewClassroom')}
                </Link>
                {!c.archivedAt && (
                  <>
                    <button
                      type="button"
                      className={styles.inlineAction}
                      onClick={() => {
                        setEditTarget(c);
                        setEditName(c.name);
                      }}
                    >
                      {t('edit.cta')}
                    </button>
                    <button type="button" className={styles.inlineAction} onClick={() => setArchiveTarget(c)}>
                      {t('archive.cta')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <Modal title={t('create.title')} onClose={() => setCreateOpen(false)}>
          <Input label={t('create.nameLabel')} value={createName} onChange={(e) => setCreateName(e.target.value)} />
          <Input label={t('create.batchYearLabel')} type="number" value={createBatchYear} onChange={(e) => setCreateBatchYear(e.target.value)} />
          <Input label={t('create.gradeLabel')} value={createGrade} onChange={(e) => setCreateGrade(e.target.value)} />
          <Input label={t('create.sectionLabel')} value={createSection} onChange={(e) => setCreateSection(e.target.value)} />
          <Input label={t('create.programLabel')} value={createProgram} onChange={(e) => setCreateProgram(e.target.value)} />
          <Button
            variant="primary"
            size="md"
            fullWidth
            loading={creating}
            disabled={!createName.trim() || !createBatchYear.trim()}
            onClick={handleCreate}
          >
            {t('create.submit')}
          </Button>
        </Modal>
      )}

      {editTarget && (
        <Modal title={t('edit.title')} onClose={() => setEditTarget(null)}>
          <Input label={t('edit.nameLabel')} value={editName} onChange={(e) => setEditName(e.target.value)} />
          <Button variant="primary" size="md" fullWidth loading={saving} disabled={!editName.trim()} onClick={handleSaveEdit}>
            {t('edit.submit')}
          </Button>
        </Modal>
      )}

      {archiveTarget && (
        <Modal title={t('archive.confirmTitle')} onClose={() => setArchiveTarget(null)}>
          <p className={styles.confirmText}>{t('archive.confirmMessage', { name: archiveTarget.name })}</p>
          <div className={styles.confirmActions}>
            <Button variant="secondary" size="md" onClick={() => setArchiveTarget(null)}>
              {t('archive.cancel')}
            </Button>
            <Button variant="danger" size="md" loading={archiving} onClick={handleArchive}>
              {t('archive.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
