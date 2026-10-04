'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstitutionCode } from '@alumini/types';
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
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import styles from './CodesTab.module.css';
import tabStyles from './Tab.module.css';

interface CodesTabProps {
  institutionId: string;
}

interface FlatClassroom {
  id: string;
  globalId: string;
  name: string;
}

const CSV_PREVIEW_ROWS = 5;

export function CodesTab({ institutionId }: CodesTabProps) {
  const t = useTranslations('adminDashboard.codes');
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<FlatClassroom[]>([]);
  const [codes, setCodes] = useState<Array<api.CodeEntry & { classroomId: string }>>([]);
  const [filterClassroomId, setFilterClassroomId] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [personalClassroomId, setPersonalClassroomId] = useState('');
  const [boundName, setBoundName] = useState('');
  const [boundEmail, setBoundEmail] = useState('');
  const [personalSubmitting, setPersonalSubmitting] = useState(false);

  const [batchClassroomId, setBatchClassroomId] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState(10);
  const [expiresInDays, setExpiresInDays] = useState<7 | 30 | 90>(30);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<InstitutionCode | null>(null);

  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const yearGroups = await api.getClassrooms(institutionId);
      const flat = yearGroups.flatMap((g) => g.classrooms.map((c) => ({ id: c.id, globalId: c.globalId, name: c.name })));
      setClassrooms(flat);
      if (flat[0]) {
        setPersonalClassroomId((prev) => prev || flat[0]!.id);
        setBatchClassroomId((prev) => prev || flat[0]!.id);
      }

      // listCodes is per classroom — no institution-wide endpoint exists —
      // so failures on individual classrooms are swallowed rather than
      // failing the whole tab. classroomId is tagged on here (client-side)
      // so the TASKS_11 TASK 06 classroom filter dropdown below has
      // something to filter on without a backend change.
      const results = await Promise.allSettled(
        flat.map((c) => api.listCodes(c.id).then((codeRows) => codeRows.map((code) => ({ ...code, classroomId: c.id })))),
      );
      setCodes(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGeneratePersonal = async () => {
    if (!personalClassroomId || !boundName.trim() || !boundEmail.trim()) return;
    setPersonalSubmitting(true);
    try {
      const code = await api.generatePersonalCode(institutionId, {
        classroomId: personalClassroomId,
        boundName: boundName.trim(),
        boundEmail: boundEmail.trim(),
      });
      showToast(t('personal.successToast', { code: code.code }), 'success');
      setBoundName('');
      setBoundEmail('');
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setPersonalSubmitting(false);
    }
  };

  const handleGenerateBatch = async () => {
    if (!batchClassroomId || maxRedemptions < 1) return;
    setBatchSubmitting(true);
    try {
      const code = await api.generateBatchCode(institutionId, { classroomId: batchClassroomId, maxRedemptions, expiresInDays });
      setGeneratedCode(code);
      showToast(t('batch.successToast', { code: code.code }), 'success');
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBatchSubmitting(false);
    }
  };

  const handleCopyGeneratedCode = () => {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode.code).then(() => showToast(t('batch.copiedToast'), 'success'));
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => showToast(t('batch.copiedToast'), 'success'));
  };

  const generatedCodeClassroomName = generatedCode
    ? classrooms.find((c) => c.id === batchClassroomId)?.name ?? ''
    : '';

  const handleShareWhatsapp = () => {
    if (!generatedCode) return;
    const message = t('batch.shareMessage', { code: generatedCode.code, classroom: generatedCodeClassroomName });
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleRevoke = async (codeId: string) => {
    setRevokingId(codeId);
    try {
      await api.revokeCode(codeId);
      showToast(t('revokedToast'), 'success');
      setCodes((prev) => prev.map((c) => (c.id === codeId ? { ...c, status: 'revoked', isActive: false } : c)));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const handleFileSelect = async (file: File) => {
    const text = await file.text();
    setCsvContent(text);
    setCsvFileName(file.name);
  };

  const handleConfirmImport = async () => {
    if (!csvContent) return;
    setCsvImporting(true);
    try {
      const result = await api.importCsv(institutionId, csvContent);
      showToast(t('csv.successToast', { count: result.generatedCount }), 'success');
      setCsvContent(null);
      setCsvFileName('');
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setCsvImporting(false);
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

  if (classrooms.length === 0) {
    return <EmptyState icon="🔑" title={t('noClassrooms.title')} description={t('noClassrooms.description')} />;
  }

  const previewRows = csvContent
    ? csvContent
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .slice(0, CSV_PREVIEW_ROWS)
    : [];

  return (
    <>
      <div className={styles.formCard}>
        <p className={tabStyles.sectionLabel}>{t('personal.title')}</p>
        <Select label={t('classroomLabel')} value={personalClassroomId} onChange={(e) => setPersonalClassroomId(e.target.value)}>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input label={t('personal.nameLabel')} value={boundName} onChange={(e) => setBoundName(e.target.value)} />
        <Input
          label={t('personal.emailLabel')}
          type="email"
          value={boundEmail}
          onChange={(e) => setBoundEmail(e.target.value)}
        />
        <Button
          variant="primary"
          size="md"
          fullWidth
          loading={personalSubmitting}
          disabled={!boundName.trim() || !boundEmail.trim()}
          onClick={handleGeneratePersonal}
        >
          {t('personal.generate')}
        </Button>
      </div>

      <div className={styles.formCard}>
        <p className={tabStyles.sectionLabel}>{t('batch.title')}</p>
        <Select label={t('classroomLabel')} value={batchClassroomId} onChange={(e) => setBatchClassroomId(e.target.value)}>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <div>
          <p className={styles.radioLabel}>{t('batch.maxRedemptionsLabel')}</p>
          <div className={styles.radioRow} role="radiogroup" aria-label={t('batch.maxRedemptionsLabel')}>
            {[10, 25, 50, 100].map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={maxRedemptions === option}
                className={`chip ${maxRedemptions === option ? 'chip-active' : ''}`}
                onClick={() => setMaxRedemptions(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className={styles.radioLabel}>{t('batch.expiresLabel')}</p>
          <div className={styles.radioRow} role="radiogroup" aria-label={t('batch.expiresLabel')}>
            {([7, 30, 90] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={expiresInDays === option}
                className={`chip ${expiresInDays === option ? 'chip-active' : ''}`}
                onClick={() => setExpiresInDays(option)}
              >
                {t(`batch.expires${option}`)}
              </button>
            ))}
          </div>
        </div>

        <Button variant="primary" size="md" fullWidth loading={batchSubmitting} onClick={handleGenerateBatch}>
          {t('batch.generate')}
        </Button>

        <p className={styles.batchWarning}>{t('batch.warning', { max: maxRedemptions })}</p>

        {generatedCode && (
          <div className={styles.generatedCodeCard}>
            <p className={styles.radioLabel}>{t('batch.generatedCodeLabel')}</p>
            <div className={styles.generatedCodeRow}>
              <span className={styles.generatedCodeValue}>{generatedCode.code}</span>
              <Button variant="ghost" size="sm" onClick={handleCopyGeneratedCode}>
                {t('batch.copyCode')}
              </Button>
            </div>
            <Button variant="secondary" size="sm" fullWidth onClick={handleShareWhatsapp}>
              {t('batch.shareWhatsapp')}
            </Button>
          </div>
        )}
      </div>

      <div className={styles.formCard}>
        <p className={tabStyles.sectionLabel}>{t('csv.title')}</p>
        <p className={styles.csvHint}>{t('csv.hint')}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className={styles.fileInput}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
        />
        <Button variant="secondary" size="md" fullWidth onClick={() => fileInputRef.current?.click()}>
          {t('csv.chooseFile')}
        </Button>
      </div>

      <div className={tabStyles.sectionHeader}>
        <span className={tabStyles.sectionLabel}>{t('activeCodes')}</span>
        <Select label={t('filterClassroomLabel')} value={filterClassroomId} onChange={(e) => setFilterClassroomId(e.target.value)}>
          <option value="">{t('filterClassroomAll')}</option>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {codes.filter((c) => !filterClassroomId || c.classroomId === filterClassroomId).length === 0 ? (
        <EmptyState icon="🔑" title={t('noCodes.title')} description={t('noCodes.description')} />
      ) : (
        codes
          .filter((c) => !filterClassroomId || c.classroomId === filterClassroomId)
          .map((code) => (
            <div key={code.id} className={`${styles.codeRow} ${!code.isActive ? styles.codeRowRevoked : ''}`}>
              <span className={styles.codeValue}>{code.code}</span>
              <span className={styles.codeMeta}>
                {t(`type.${code.type}`)} · {t(`codeStatus.${code.status}`)}
                {code.maxRedemptions ? ` · ${code.redemptionCount}/${code.maxRedemptions}` : ''}
              </span>
              <span className={styles.codeExpiry}>{t('expires', { date: safeFormatDate(code.expiresAt) })}</span>
              <div className={styles.codeActions}>
                <Button variant="ghost" size="sm" onClick={() => handleCopyCode(code.code)}>
                  {t('copyAction')}
                </Button>
                {code.isActive && (
                  <Button variant="ghost" size="sm" loading={revokingId === code.id} onClick={() => handleRevoke(code.id)}>
                    {t('revokeAction')}
                  </Button>
                )}
              </div>
            </div>
          ))
      )}

      {csvContent && (
        <Modal title={t('csv.confirmTitle')} onClose={() => setCsvContent(null)}>
          <p className={styles.csvFileName}>{csvFileName}</p>
          <div className={styles.csvPreview}>
            {previewRows.map((row, i) => (
              <p key={i} className={styles.csvPreviewRow}>
                {row}
              </p>
            ))}
          </div>
          <div className={styles.csvActions}>
            <Button variant="secondary" size="md" onClick={() => setCsvContent(null)}>
              {t('csv.cancel')}
            </Button>
            <Button variant="primary" size="md" loading={csvImporting} onClick={handleConfirmImport}>
              {t('csv.confirmImport')}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
