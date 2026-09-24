'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Institution } from '@alumini/types';
import * as api from '@/lib/api';
import type { ClassroomSearchResult } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { useDebounce } from '@/lib/useDebounce';
import { useToast } from '@/components/providers/ToastProvider';
import { useTranslations } from '@/lib/useTranslations';
import { COMMON_COUNTRIES, OTHER_COUNTRIES } from '@/lib/countries';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import styles from './NewUserLanding.module.css';

export type LandingVariant = 'student' | 'teacher' | 'admin';

interface NewUserLandingProps {
  variant: LandingVariant;
  firstName: string;
  /** Called after a successful join/claim so the home page can drop the landing screen without a reload. */
  onJoined: () => void;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

/**
 * TASKS_09 TASK 01 — new user landing screen, shown instead of the empty
 * state when a user has zero memberships. Adapts to the caller's persona:
 * student (default), teacher, or admin (school_admin persona / platform
 * admin). Reuses this codebase's already-built search endpoints
 * (searchClassrooms/searchInstitutions — see classes/page.tsx's "Find your
 * batch" discovery and onboarding/claim/page.tsx's claim flow) rather than
 * inventing a separate institution-then-classroom two-step search the
 * backend has no endpoint for.
 */
export function NewUserLanding({ variant, firstName, onJoined }: NewUserLandingProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const t = useTranslations('home.landing');

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Student/teacher — classroom results.
  const [classroomResults, setClassroomResults] = useState<ClassroomSearchResult[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Admin — institution results.
  const [institutionResults, setInstitutionResults] = useState<Institution[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  // Admin — inline "request your institution" form.
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestType, setRequestType] = useState<'school' | 'college' | 'university'>('school');
  const [requestCountryCode, setRequestCountryCode] = useState('IN');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState(false);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setClassroomResults([]);
      setInstitutionResults([]);
      setSearchError(null);
      setSearched(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const request =
      variant === 'admin' ? api.searchInstitutions(q) : api.searchClassrooms(q, 10);
    request
      .then((data) => {
        if (cancelled) return;
        if (variant === 'admin') {
          setInstitutionResults(data as Institution[]);
        } else {
          setClassroomResults(data as ClassroomSearchResult[]);
        }
        setSearched(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, variant]);

  const handleJoin = async (result: ClassroomSearchResult) => {
    setJoiningId(result.id);
    try {
      await api.joinClassroom(result.id);
      showToast(
        result.verificationRequired ? t('joinedRequestedToast') : t('joinedToast'),
        'success',
      );
      onJoined();
      router.push(`/classroom/${result.globalId}`);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setJoiningId(null);
    }
  };

  const handleClaim = async (institution: Institution) => {
    setClaimingId(institution.id);
    try {
      // Same two-call sequence as onboarding/claim/page.tsx's handleClaim()
      // — a pending school_admin persona plus the claim itself for
      // platform-admin review.
      await api.addPersona('school_admin', institution.id);
      await api.claimInstitution(institution.id);
      showToast(t('admin.claimSubmittedToast'), 'success');
      onJoined();
      router.push('/admin');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setClaimingId(null);
    }
  };

  const canSubmitRequest = requestName.trim().length >= 2;

  const handleSubmitRequest = async () => {
    if (!canSubmitRequest) return;
    setRequesting(true);
    setRequestError(null);
    try {
      await api.requestInstitution({
        name: requestName.trim(),
        type: requestType,
        countryCode: requestCountryCode,
        requesterRelationship: 'admin',
      });
      setRequestSuccess(true);
    } catch (err) {
      setRequestError(getErrorMessage(err));
    } finally {
      setRequesting(false);
    }
  };

  const showHowItWorks = variant === 'student' || variant === 'teacher';

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.welcome}>{t('headerWelcome', { name: firstName })}</h1>
        <p className={styles.subtitle}>{t(`${variant}.subtitle`)}</p>
      </div>

      <div className={styles.searchCard}>
        <Input
          label={t(`${variant}.searchPlaceholder`)}
          placeholder={t(`${variant}.searchPlaceholder`)}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {searching && (
          <div className={styles.searchStatus}>
            <LoadingSpinner size="sm" />
          </div>
        )}

        {searchError && !searching && <ErrorMessage message={searchError} />}

        {!searching && !searchError && variant !== 'admin' && searched && classroomResults.length === 0 && (
          <div className={styles.noResults}>
            <p>{t('noResults')}</p>
            <button type="button" className={styles.createLink} onClick={() => router.push('/classroom/create')}>
              {t('createThisClassroom')}
            </button>
          </div>
        )}

        {!searching && variant !== 'admin' && classroomResults.length > 0 && (
          <ul className={styles.results}>
            {classroomResults.map((result) => (
              <li key={result.id} className={styles.resultCard}>
                <span className={styles.resultIcon} aria-hidden="true">
                  <SchoolIcon />
                </span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultName}>{result.name}</span>
                  <span className={styles.resultMeta}>
                    {result.institutionName ? `${result.institutionName} · ` : ''}
                    {result.batchYear} · {result.memberCount}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={joiningId === result.id}
                  onClick={() => handleJoin(result)}
                >
                  {t(`${variant}.joinButton`)}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {!searching && !searchError && variant === 'admin' && !showRequestForm && searched && institutionResults.length === 0 && (
          <div className={styles.noResults}>
            <p>{t('noResults')}</p>
            <button type="button" className={styles.createLink} onClick={() => setShowRequestForm(true)}>
              {t('admin.requestLink')}
            </button>
          </div>
        )}

        {!searching && variant === 'admin' && institutionResults.length > 0 && (
          <ul className={styles.results}>
            {institutionResults.map((institution) => (
              <li key={institution.id} className={styles.resultCard}>
                <span className={styles.resultIcon} aria-hidden="true">
                  <BuildingIcon />
                </span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultName}>{institution.name}</span>
                  <span className={styles.resultMeta}>
                    {institution.type}
                    {institution.cityCode ? ` · ${institution.cityCode}` : ''} · {institution.countryCode}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={claimingId === institution.id}
                  onClick={() => handleClaim(institution)}
                >
                  {t('admin.claimButton')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {variant === 'admin' && (
        <div className={styles.infoCard}>
          <p>{t('admin.infoCard')}</p>
        </div>
      )}

      {variant === 'admin' && !showRequestForm && (
        <button type="button" className={styles.requestLinkStandalone} onClick={() => setShowRequestForm(true)}>
          {t('admin.requestLink')}
        </button>
      )}

      {variant === 'admin' && showRequestForm && (
        <div className={styles.requestForm}>
          {requestSuccess ? (
            <p className={styles.requestSuccess}>{t('admin.requestForm.successMessage')}</p>
          ) : (
            <>
              <Input
                label={t('admin.requestForm.nameLabel')}
                value={requestName}
                onChange={(e) => setRequestName(e.target.value)}
              />
              <Select
                label={t('admin.requestForm.typeLabel')}
                value={requestType}
                onChange={(e) => setRequestType(e.target.value as 'school' | 'college' | 'university')}
              >
                <option value="school">School</option>
                <option value="college">College</option>
                <option value="university">University</option>
              </Select>
              <Select
                label={t('admin.requestForm.countryLabel')}
                value={requestCountryCode}
                onChange={(e) => setRequestCountryCode(e.target.value)}
              >
                {COMMON_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
                {OTHER_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {requestError && <ErrorMessage message={requestError} />}
              <Button
                variant="primary"
                size="md"
                fullWidth
                disabled={!canSubmitRequest}
                loading={requesting}
                onClick={handleSubmitRequest}
              >
                {t('admin.requestForm.submitButton')}
              </Button>
            </>
          )}
        </div>
      )}

      <div className={styles.actionGrid}>
        {variant === 'admin' ? (
          <>
            <ActionCard icon={<BuildingIcon />} title={t('admin.actions.find.title')} description={t('admin.actions.find.description')} onClick={() => document.querySelector('input')?.focus()} />
            <ActionCard icon={<SendIcon />} title={t('admin.actions.request.title')} description={t('admin.actions.request.description')} onClick={() => setShowRequestForm(true)} />
          </>
        ) : (
          <>
            <ActionCard
              icon={<SchoolIcon />}
              title={t(`${variant}.actions.join.title`)}
              description={t(`${variant}.actions.join.description`)}
              onClick={() => document.querySelector('input')?.focus()}
            />
            <ActionCard
              icon={<PlusIcon />}
              title={t(`${variant}.actions.create.title`)}
              description={t(`${variant}.actions.create.description`)}
              onClick={() => router.push('/classroom/create')}
            />
          </>
        )}
      </div>

      {showHowItWorks && (
        <div className={styles.howItWorks}>
          <p className={styles.howItWorksHeading}>{t('howItWorksHeading')}</p>
          <div className={styles.steps}>
            {(['step1', 'step2', 'step3'] as const).map((step, i) => (
              <div key={step} className={styles.step}>
                <span className={styles.stepCircle}>{i + 1}</span>
                <span className={styles.stepLabel}>{t(`${variant}.howItWorks.${step}`)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Icons — hand-rolled inline SVG, matching this codebase's established
// convention (see AuthLayout.tsx's own ICON_PROPS comment) rather than
// pulling in an icon-font package that isn't installed anywhere here. ──

const ICON_PROPS = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function SchoolIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3 2 8l10 5 10-5-10-5Z" />
      <path d="M6 10.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-5.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.actionCard} onClick={onClick}>
      <span className={styles.actionIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.actionTitle}>{title}</span>
      <span className={styles.actionDescription}>{description}</span>
    </button>
  );
}
