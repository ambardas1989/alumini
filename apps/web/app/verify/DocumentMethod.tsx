'use client';

import { useRef, useState } from 'react';
import * as api from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { supabase, VERIFICATION_DOCUMENTS_BUCKET } from '@/lib/supabase';
import { safeFormatDate } from '@/lib/format';
import { useTranslations } from '@/lib/useTranslations';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import type { MethodProps } from './types';
import styles from './DocumentMethod.module.css';

interface DocumentMethodProps extends MethodProps {
  initialPhase: 'upload' | 'pending' | 'rejected';
  rejectionReason: string | null;
  submittedDate: string | null;
  onSubmitted: () => void;
}

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ACCEPTED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png';
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentMethod({ classroomId, initialPhase, rejectionReason, submittedDate, onSubmitted }: DocumentMethodProps) {
  const t = useTranslations('verification.methods.document');

  const [phase, setPhase] = useState(initialPhase);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (candidate: File): string | null => {
    if (!ACCEPTED_TYPES.includes(candidate.type)) return t('errors.wrongType');
    if (candidate.size > MAX_SIZE_BYTES) return t('errors.tooLarge');
    return null;
  };

  const handleFileChosen = (candidate: File) => {
    const error = validateFile(candidate);
    if (error) {
      setFileError(error);
      setFile(null);
      return;
    }
    setFileError(null);
    setFile(candidate);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileChosen(dropped);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setProgress(15);
    try {
      const path = `${classroomId}/${Date.now()}-${file.name}`;
      const { error: storageError } = await supabase.storage
        .from(VERIFICATION_DOCUMENTS_BUCKET)
        .upload(path, file);
      if (storageError) throw storageError;
      // Supabase JS's storage upload doesn't expose real byte-level
      // progress events (it's a single fetch call under the hood) — this
      // is a coarse two-step indicator (uploaded vs. submitted), not a
      // precise percentage.
      setProgress(70);
      await api.submitDocument(classroomId, path);
      setProgress(100);
      setPhase('pending');
      onSubmitted();
    } catch (err) {
      setUploadError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  if (phase === 'pending') {
    return (
      <div className={styles.infoCard}>
        <p className={styles.infoTitle}>{t('pendingTitle')}</p>
        <p className={styles.infoBody}>{t('pendingBody')}</p>
        {submittedDate && <p className={styles.infoMeta}>{t('submittedOn', { date: safeFormatDate(submittedDate) })}</p>}
      </div>
    );
  }

  if (phase === 'rejected') {
    return (
      <div className={styles.rejectedCard}>
        <p className={styles.infoTitle}>{t('rejectedTitle')}</p>
        {rejectionReason && <p className={styles.infoBody}>{rejectionReason}</p>}
        <Button variant="secondary" size="sm" onClick={() => setPhase('upload')}>
          {t('tryAgainButton')}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.hint}>{t('acceptedTypes')}</p>

      {!file ? (
        <div
          className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path d="M12 16V4M12 4 7 9M12 4l5 5" />
            <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
          <p className={styles.dropZoneText}>{t('dropZoneLabel')}</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className={styles.hiddenInput}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) handleFileChosen(chosen);
            }}
          />
        </div>
      ) : (
        <div className={styles.fileRow}>
          <div className={styles.fileInfo}>
            <p className={styles.fileName}>{file.name}</p>
            <p className={styles.fileSize}>{formatFileSize(file.size)}</p>
          </div>
          {!uploading && (
            <button type="button" className={styles.removeButton} onClick={() => setFile(null)} aria-label={t('removeFile')}>
              ×
            </button>
          )}
        </div>
      )}

      {fileError && <ErrorMessage message={fileError} />}

      {uploading && (
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      )}
      {uploading && <p className={styles.hint}>{t('uploading')}</p>}
      {uploadError && <ErrorMessage message={uploadError} />}

      <p className={styles.privacyNote}>{t('privacyNote')}</p>

      <Button variant="primary" size="md" fullWidth disabled={!file} loading={uploading} onClick={handleUpload}>
        {t('submitButton')}
      </Button>
    </div>
  );
}
