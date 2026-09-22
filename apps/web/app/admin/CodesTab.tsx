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
  const [codes, setCodes] = useState<api.CodeEntry[]>([]);

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
      // failing the whole tab.
      const results = await Promise.allSettled(flat.map((c) => api.listCodes(c.id)));
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

      <p className={tabStyles.sectionLabel}>{t('activeCodes')}</p>
      {codes.length === 0 ? (
        <EmptyState icon="🔑" title={t('noCodes.title')} description={t('noCodes.description')} />
      ) : (
        codes.map((code) => (
          <div key={code.id} className={styles.codeRow}>
            <span className={styles.codeValue}>{code.code}</span>
            <span className={styles.codeMeta}>
              {t(`type.${code.type}`)} · {t(`codeStatus.${code.status}`)}
              {code.maxRedemptions ? ` · ${code.redemptionCount}/${code.maxRedemptions}` : ''}
            </span>
            <span className={styles.codeExpiry}>{t('expires', { date: safeFormatDate(code.expiresAt) })}</span>
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
