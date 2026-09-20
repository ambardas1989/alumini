'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Institution } from '@alumini/types';
import { generateClassroomId } from '@alumini/utils';
import * as api from '@/lib/api';
import { ApiError, type ClassroomConflictPayload, type InstitutionConflictPayload } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useDebounce } from '@/lib/useDebounce';
import { useTranslations } from '@/lib/useTranslations';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './ClassroomCreateForm.module.css';

type InstitutionType = 'school' | 'college' | 'university';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 300;
const MAX_RESULTS = 8;
const MIN_BATCH_YEAR = 1950;
const CURRENT_YEAR = new Date().getFullYear();
const MAX_BATCH_YEAR = CURRENT_YEAR + 5;

const GRADES = Array.from({ length: 12 }, (_, i) => String(i + 1));
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'];
const PROGRAM_SUGGESTIONS = ['MBA', 'B.Tech', 'MBBS', 'B.Com', 'BA', 'B.Sc', 'LLB', 'M.Tech'];

interface ClassroomCreateFormProps {
  /** Called with the resulting classroom's globalId after a successful create OR after joining an existing (409-conflict) classroom instead. */
  onDone: (globalId: string) => void;
}

/**
 * Extracted from what used to be the entire body of apps/web/app/classroom/create/page.tsx
 * (TASK 08 — the Classes tab now embeds this inline instead of navigating to a separate
 * page; the standalone /classroom/create route still exists as a thin wrapper around this
 * same component, so any existing link to it keeps working unchanged).
 */
export function ClassroomCreateForm({ onDone }: ClassroomCreateFormProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const t = useTranslations('classroomCreate');
  const tCommon = useTranslations('common');

  const [type, setType] = useState<InstitutionType>('school');

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const [results, setResults] = useState<Institution[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [selectedInstitution, setSelectedInstitution] = useState<Institution | null>(null);

  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [customSection, setCustomSection] = useState('');
  const [program, setProgram] = useState('');
  const [batchYear, setBatchYear] = useState(String(CURRENT_YEAR));
  const [batchYearError, setBatchYearError] = useState<string | null>(null);

  const [hasStaffRoom, setHasStaffRoom] = useState(true);
  const [hasStudentAlley, setHasStudentAlley] = useState(true);
  const [requireVerification, setRequireVerification] = useState(true);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ClassroomConflictPayload | null>(null);
  const [joiningConflict, setJoiningConflict] = useState(false);

  // ── Institution request (TASK 05 — "Can't find your school?") ──────────
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestCity, setRequestCity] = useState('');
  const [requestCountryCode, setRequestCountryCode] = useState('IN');
  const [requestWebsite, setRequestWebsite] = useState('');
  const [requestRelationship, setRequestRelationship] = useState<'alumni' | 'teacher' | 'admin'>('alumni');
  const [requestNotes, setRequestNotes] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<{ requestId: string } | null>(null);
  const [requestConflict, setRequestConflict] = useState<InstitutionConflictPayload | null>(null);

  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Institution search — client-side filtered by `type`: SearchInstitutionsDto
  // on the backend only accepts `q`/`countryCode`, no `type` field, so there's
  // no server-side filter to ask for.
  useEffect(() => {
    if (selectedInstitution || debouncedQuery.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    api
      .searchInstitutions(debouncedQuery.trim())
      .then((data) => {
        if (cancelled) return;
        const filtered = data.filter((i) => i.type === type).slice(0, MAX_RESULTS);
        setResults(filtered);
        setHighlighted(-1);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selectedInstitution, type]);

  const handleTypeChange = (next: InstitutionType) => {
    setType(next);
    setSelectedInstitution(null);
    setQuery('');
    setResults([]);
    setGrade('');
    setSection('');
    setCustomSection('');
    setProgram('');
  };

  const handleSelectInstitution = (institution: Institution) => {
    setSelectedInstitution(institution);
    setResults([]);
    setHighlighted(-1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => {
        const next = Math.min(i + 1, results.length - 1);
        resultRefs.current[next]?.focus();
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => {
        const next = Math.max(i - 1, 0);
        resultRefs.current[next]?.focus();
        return next;
      });
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      handleSelectInstitution(results[highlighted]!);
    }
  };

  const handleNotFound = () => {
    setShowRequestForm(true);
    setRequestName(query.trim());
    setRequestSuccess(null);
    setRequestConflict(null);
    setRequestError(null);
  };

  const canSubmitRequest = !!requestName.trim() && !!requestCity.trim();

  const handleSubmitRequest = async () => {
    if (!canSubmitRequest) return;
    setRequesting(true);
    setRequestError(null);
    setRequestConflict(null);
    try {
      const result = await api.requestInstitution({
        name: requestName.trim(),
        type,
        city: requestCity.trim(),
        countryCode: requestCountryCode.trim().toUpperCase(),
        websiteUrl: requestWebsite.trim() || undefined,
        requesterRelationship: requestRelationship,
        notes: requestNotes.trim() || undefined,
      });
      setRequestSuccess({ requestId: result.requestId });
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setRequestConflict(err.payload as InstitutionConflictPayload);
      } else {
        setRequestError(getErrorMessage(err));
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleUseExistingInstitution = async () => {
    if (!requestConflict) return;
    try {
      const results = await api.searchInstitutions(requestConflict.existingInstitutionName);
      const match = results.find((i) => i.id === requestConflict.existingInstitutionId);
      if (match) {
        handleSelectInstitution(match);
        setShowRequestForm(false);
        setRequestConflict(null);
      }
    } catch (err) {
      setRequestError(getErrorMessage(err));
    }
  };

  const handleBatchYearChange = (value: string) => {
    setBatchYear(value);
    const year = parseInt(value, 10);
    if (!value || Number.isNaN(year) || year < MIN_BATCH_YEAR || year > MAX_BATCH_YEAR) {
      setBatchYearError(t('batchYearError', { min: MIN_BATCH_YEAR, max: MAX_BATCH_YEAR }));
    } else {
      setBatchYearError(null);
    }
  };

  const resolvedSection = section === 'other' ? customSection.trim() : section;

  const globalIdPreview = useMemo(() => {
    if (!selectedInstitution || !batchYear || batchYearError) return null;
    const year = parseInt(batchYear, 10);
    if (Number.isNaN(year)) return null;
    if (type === 'school' && !grade) return null;
    if (type !== 'school' && !program.trim()) return null;
    try {
      return generateClassroomId({
        countryCode: selectedInstitution.countryCode,
        cityCode: selectedInstitution.cityCode,
        institutionSlug: selectedInstitution.slug,
        grade: type === 'school' ? grade : undefined,
        section: type === 'school' ? resolvedSection || undefined : undefined,
        program: type !== 'school' ? program.trim() : undefined,
        batchYear: year,
      });
    } catch {
      return null;
    }
  }, [selectedInstitution, batchYear, batchYearError, type, grade, resolvedSection, program]);

  const canCreate =
    !!selectedInstitution &&
    !!batchYear &&
    !batchYearError &&
    (type === 'school' ? !!grade : !!program.trim());

  const handleCreate = async () => {
    if (!selectedInstitution || !canCreate) return;
    setCreating(true);
    setCreateError(null);
    setConflict(null);
    try {
      // Task's spec collects no separate classroom "name" field (neither
      // does the mockup's SC screen) — CreateClassroomDto requires one, so
      // it's derived from the fields actually collected here.
      const name =
        type === 'school' ? `Grade ${grade}${resolvedSection}` : program.trim();

      const classroom = await api.createClassroom({
        institutionId: selectedInstitution.id,
        name,
        batchYear: parseInt(batchYear, 10),
        grade: type === 'school' ? grade : undefined,
        section: type === 'school' ? resolvedSection || undefined : undefined,
        program: type !== 'school' ? program.trim() : undefined,
        hasStaffRoom,
        hasStudentAlley,
        requireVerification,
      });
      showToast(t('successToast'), 'success');
      onDone(classroom.globalId);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setConflict(err.payload as ClassroomConflictPayload);
      } else {
        setCreateError(getErrorMessage(err));
      }
    } finally {
      setCreating(false);
    }
  };

  const handleJoinConflict = async () => {
    if (!conflict) return;
    setJoiningConflict(true);
    try {
      await api.joinClassroom(conflict.existingClassroomId);
      onDone(conflict.globalId);
    } catch (err) {
      setCreateError(getErrorMessage(err));
      setConflict(null);
    } finally {
      setJoiningConflict(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.typeToggle} role="tablist">
        {(['school', 'college', 'university'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={type === option}
            className={`${styles.typeTab} ${type === option ? styles.typeTabActive : ''}`}
            onClick={() => handleTypeChange(option)}
          >
            {t(option === 'school' ? 'typeSchool' : option === 'college' ? 'typeCollege' : 'typeUniversity')}
          </button>
        ))}
      </div>

      {!selectedInstitution && (
        <div className={styles.searchWrap}>
          <Input
            label={t('institutionSearchLabel')}
            placeholder={t('institutionSearchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="institution-results"
          />

          {searching && (
            <div className={styles.searchStatus}>
              <LoadingSpinner size="sm" />
            </div>
          )}
          {searchError && <ErrorMessage message={searchError} />}

          {!searching && results.length > 0 && (
            <ul id="institution-results" className={styles.results} role="listbox">
              {results.map((institution, index) => (
                <li key={institution.id}>
                  <button
                    type="button"
                    ref={(el) => {
                      resultRefs.current[index] = el;
                    }}
                    role="option"
                    aria-selected={highlighted === index}
                    className={`${styles.resultRow} ${highlighted === index ? styles.resultRowHighlighted : ''}`}
                    onClick={() => handleSelectInstitution(institution)}
                  >
                    <span className={styles.resultName}>{institution.name}</span>
                    <span className={styles.resultMeta}>
                      {institution.cityCode ? `${institution.cityCode}, ` : ''}
                      {institution.countryCode}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!searching && results.length === 0 && debouncedQuery.trim().length >= MIN_QUERY_LENGTH && !showRequestForm && (
            <div className={styles.notFoundWrap}>
              <p className={styles.notFoundText}>{t('notFound')}</p>
              <button type="button" className={styles.notFound} onClick={handleNotFound}>
                {t('requestForm.cta')}
              </button>
            </div>
          )}

          {showRequestForm && (
            <div className={styles.requestForm}>
              {requestSuccess ? (
                <div className={styles.requestSuccess}>
                  <p>{t('requestForm.successMessage', { email: user?.email ?? '' })}</p>
                  <p className={styles.requestId}>{t('requestForm.requestId', { id: requestSuccess.requestId })}</p>
                </div>
              ) : requestConflict ? (
                <div className={styles.requestConflict}>
                  <p>{t('requestForm.conflictMessage', { name: requestConflict.existingInstitutionName })}</p>
                  <button type="button" className={styles.changeLink} onClick={handleUseExistingInstitution}>
                    {t('requestForm.useExisting')}
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    label={t('requestForm.nameLabel')}
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                  />
                  <Input
                    label={t('requestForm.cityLabel')}
                    value={requestCity}
                    onChange={(e) => setRequestCity(e.target.value)}
                  />
                  <Input
                    label={t('requestForm.countryLabel')}
                    value={requestCountryCode}
                    onChange={(e) => setRequestCountryCode(e.target.value)}
                  />
                  <Input
                    label={t('requestForm.websiteLabel')}
                    placeholder="https://..."
                    value={requestWebsite}
                    onChange={(e) => setRequestWebsite(e.target.value)}
                  />
                  <Select
                    label={t('requestForm.relationshipLabel')}
                    value={requestRelationship}
                    onChange={(e) => setRequestRelationship(e.target.value as typeof requestRelationship)}
                  >
                    <option value="alumni">{t('requestForm.relationship.alumni')}</option>
                    <option value="teacher">{t('requestForm.relationship.teacher')}</option>
                    <option value="admin">{t('requestForm.relationship.admin')}</option>
                  </Select>
                  <Textarea
                    label={t('requestForm.notesLabel')}
                    value={requestNotes}
                    onChange={(e) => setRequestNotes(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                  {requestError && <ErrorMessage message={requestError} />}
                  <div className={styles.requestFormActions}>
                    <Button variant="ghost" size="md" onClick={() => setShowRequestForm(false)} disabled={requesting}>
                      {tCommon('cancel')}
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      fullWidth
                      disabled={!canSubmitRequest}
                      loading={requesting}
                      onClick={handleSubmitRequest}
                    >
                      {t('requestForm.submit')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {selectedInstitution && (
        <div className={styles.selectedCard}>
          <div>
            <p className={styles.resultName}>{selectedInstitution.name}</p>
            <span className={styles.typeBadge}>{selectedInstitution.type}</span>
          </div>
          <button type="button" className={styles.changeLink} onClick={() => setSelectedInstitution(null)}>
            {tCommon('change')}
          </button>
        </div>
      )}

      {type === 'school' ? (
        <div className={styles.fieldRow}>
          <Select label={t('gradeLabel')} value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">{t('gradePlaceholder')}</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select label={t('sectionLabel')} value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">{t('sectionPlaceholder')}</option>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="other">{t('sectionOther')}</option>
          </Select>
        </div>
      ) : (
        <div>
          <Input
            label={t('programLabel')}
            placeholder={t('programPlaceholder')}
            value={program}
            onChange={(e) => setProgram(e.target.value)}
          />
          <div className={styles.chips}>
            {PROGRAM_SUGGESTIONS.map((chip) => (
              <button key={chip} type="button" className={styles.chip} onClick={() => setProgram(chip)}>
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      {type === 'school' && section === 'other' && (
        <Input
          label={t('sectionOtherPlaceholder')}
          value={customSection}
          onChange={(e) => setCustomSection(e.target.value)}
        />
      )}

      <Input
        label={t('batchYearLabel')}
        type="number"
        inputMode="numeric"
        value={batchYear}
        error={batchYearError ?? undefined}
        onChange={(e) => handleBatchYearChange(e.target.value)}
      />

      {selectedInstitution && (
        <div className={styles.idPreview}>
          <p className={styles.idLabel}>{t('globalIdLabel')}</p>
          {globalIdPreview ? (
            <p className={styles.idValue}>{globalIdPreview}</p>
          ) : (
            <p className={styles.idHint}>
              {t(type === 'school' ? 'globalIdHintSchool' : 'globalIdHintCollege')}
            </p>
          )}
        </div>
      )}

      <div className={styles.settings}>
        <Switch
          label={t('staffRoomLabel')}
          description={t('staffRoomDescription')}
          checked={hasStaffRoom}
          onChange={setHasStaffRoom}
        />
        <Switch
          label={t('studentAlleyLabel')}
          description={t('studentAlleyDescription')}
          checked={hasStudentAlley}
          onChange={setHasStudentAlley}
        />
        <Switch
          label={t('requireVerificationLabel')}
          description={t('requireVerificationDescription')}
          checked={requireVerification}
          onChange={setRequireVerification}
        />
      </div>

      {createError && <ErrorMessage message={createError} />}

      <Button
        variant="primary"
        size="lg"
        fullWidth
        disabled={!canCreate}
        loading={creating}
        onClick={handleCreate}
      >
        {creating ? t('creating') : t('createButton')}
      </Button>

      {conflict && (
        <Modal title={t('conflict.title')} onClose={() => setConflict(null)}>
          <p className={styles.conflictMessage}>{t('conflict.message', { count: conflict.memberCount })}</p>
          <div className={styles.conflictActions}>
            <Button variant="ghost" size="md" onClick={() => setConflict(null)} disabled={joiningConflict}>
              {t('conflict.cancelButton')}
            </Button>
            <Button variant="primary" size="md" loading={joiningConflict} onClick={handleJoinConflict}>
              {t('conflict.joinButton')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
